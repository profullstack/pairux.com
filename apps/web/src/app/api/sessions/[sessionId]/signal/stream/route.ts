import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { z } from 'zod';

// Type for session (until Supabase types are regenerated)
interface Session {
  id: string;
  status: string;
  host_user_id: string | null;
}

// Query params schema
const querySchema = z.object({
  participantId: z.string().optional(),
});

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;

// GET /api/sessions/[sessionId]/signal/stream - SSE stream for WebRTC signaling
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const { searchParams } = new URL(request.url);
    const parseResult = querySchema.safeParse({
      participantId: searchParams.get('participantId') ?? undefined,
    });

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({ error: parseResult.error.errors[0]?.message ?? 'Invalid parameters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { participantId } = parseResult.data;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);

    // Verify session exists and is active
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('id, status, host_user_id')
      .eq('id', sessionId)
      .single();

    const session = sessionData as Session | null;

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (session.status === 'ended') {
      return new Response(JSON.stringify({ error: 'Session has ended' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine the subscriber's ID (for filtering messages)
    const subscriberId = user?.id ?? participantId;
    const isHost = user?.id === session.host_user_id;

    if (!subscriberId && !isHost) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let isStreamClosed = false;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        const connectEvent = `event: connected\ndata: ${JSON.stringify({ sessionId, subscriberId, isHost })}\n\n`;
        controller.enqueue(encoder.encode(connectEvent));

        // Set up heartbeat to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (!isStreamClosed) {
            try {
              const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
              controller.enqueue(encoder.encode(heartbeat));
            } catch {
              isStreamClosed = true;
              if (heartbeatInterval) clearInterval(heartbeatInterval);
            }
          }
        }, HEARTBEAT_INTERVAL);

        // Subscribe to signaling channel
        const channel = supabase
          .channel(`session:${sessionId}`, {
            config: {
              broadcast: { self: false },
            },
          })
          .on('broadcast', { event: 'signal' }, ({ payload }) => {
            if (!isStreamClosed) {
              try {
                // Forward signal to client
                // Filter: only send if this message is for us (targetId matches or no targetId)
                const signal = payload as {
                  senderId?: string;
                  targetId?: string;
                  type?: string;
                };

                // Don't send our own signals back
                if (signal.senderId === subscriberId) {
                  return;
                }

                // Only send if targeted to us or broadcast (no targetId)
                if (signal.targetId && signal.targetId !== subscriberId) {
                  return;
                }

                const signalEvent = `event: signal\ndata: ${JSON.stringify(payload)}\n\n`;
                controller.enqueue(encoder.encode(signalEvent));
              } catch {
                isStreamClosed = true;
              }
            }
          })
          .on('presence', { event: 'join' }, ({ newPresences }) => {
            if (!isStreamClosed) {
              try {
                const presenceEvent = `event: presence-join\ndata: ${JSON.stringify({ presences: newPresences })}\n\n`;
                controller.enqueue(encoder.encode(presenceEvent));
              } catch {
                isStreamClosed = true;
              }
            }
          })
          .on('presence', { event: 'leave' }, ({ leftPresences }) => {
            if (!isStreamClosed) {
              try {
                const presenceEvent = `event: presence-leave\ndata: ${JSON.stringify({ presences: leftPresences })}\n\n`;
                controller.enqueue(encoder.encode(presenceEvent));
              } catch {
                isStreamClosed = true;
              }
            }
          })
          .subscribe((status) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (status === 'SUBSCRIBED') {
              // Track presence for this subscriber
              void channel.track({
                user_id: subscriberId,
                online_at: new Date().toISOString(),
                role: isHost ? 'host' : 'viewer',
              });

              if (!isStreamClosed) {
                try {
                  const subEvent = `event: subscribed\ndata: ${JSON.stringify({ channel: `session:${sessionId}` })}\n\n`;
                  controller.enqueue(encoder.encode(subEvent));
                } catch {
                  isStreamClosed = true;
                }
              }
              // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              if (!isStreamClosed) {
                try {
                  const errorEvent = `event: error\ndata: ${JSON.stringify({ error: 'Subscription failed' })}\n\n`;
                  controller.enqueue(encoder.encode(errorEvent));
                  controller.close();
                } catch {
                  // Ignore
                }
              }
              isStreamClosed = true;
              if (heartbeatInterval) clearInterval(heartbeatInterval);
            }
          });

        // Handle client disconnect via AbortSignal
        request.signal.addEventListener('abort', () => {
          isStreamClosed = true;
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          void supabase.removeChannel(channel);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
      },

      cancel() {
        isStreamClosed = true;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Signal stream error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
