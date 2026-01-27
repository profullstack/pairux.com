import { createClient } from '@/lib/supabase/server';
import { CORS_HEADERS } from '@/lib/cors';
import { z } from 'zod';

// Query params schema
const querySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;

// GET /api/chat/stream - Server-Sent Events stream for real-time chat
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parseResult = querySchema.safeParse({
      sessionId: searchParams.get('sessionId'),
    });

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({ error: parseResult.error.errors[0]?.message ?? 'Invalid parameters' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const { sessionId } = parseResult.data;
    const supabase = await createClient();

    // Check if session exists and is active
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('id', sessionId)
      .single();

    // sessionData can be null if not found
    const session = sessionData as { id: string; status: string } | null;

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (session.status === 'ended') {
      return new Response(JSON.stringify({ error: 'Session has ended' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let isStreamClosed = false;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        const connectEvent = `event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`;
        controller.enqueue(encoder.encode(connectEvent));

        // Set up heartbeat to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (!isStreamClosed) {
            try {
              const heartbeat = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
              controller.enqueue(encoder.encode(heartbeat));
            } catch {
              // Stream likely closed
              isStreamClosed = true;
              if (heartbeatInterval) clearInterval(heartbeatInterval);
            }
          }
        }, HEARTBEAT_INTERVAL);

        // Subscribe to new messages using Supabase Realtime
        const channel = supabase
          .channel(`chat:${sessionId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'chat_messages',
              filter: `session_id=eq.${sessionId}`,
            },
            (payload) => {
              if (!isStreamClosed) {
                try {
                  const messageEvent = `event: message\ndata: ${JSON.stringify(payload.new)}\n\n`;
                  controller.enqueue(encoder.encode(messageEvent));
                } catch {
                  // Stream closed
                  isStreamClosed = true;
                }
              }
            }
          )
          .subscribe((status) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (status === 'SUBSCRIBED') {
              // Send subscription confirmation
              if (!isStreamClosed) {
                try {
                  const subEvent = `event: subscribed\ndata: ${JSON.stringify({ channel: `chat:${sessionId}` })}\n\n`;
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
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error('Chat stream error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
