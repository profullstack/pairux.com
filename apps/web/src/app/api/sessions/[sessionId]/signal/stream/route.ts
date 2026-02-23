import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@pairux/shared-types';
import { CORS_HEADERS } from '@/lib/cors';
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
  token: z.string().optional(), // Bearer token for desktop app (EventSource doesn't support headers)
});

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;

// Build ICE servers config including TURN (if available) so clients don't
// need to hardcode credentials.
function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrls = [
    process.env.TURN_SERVER_URL,
    process.env.TURNS_SERVER_URL,
    process.env.TURN_SERVER_IP_URL,
    process.env.TURNS_SERVER_IP_URL,
  ];
  const turnUser = process.env.TURN_SERVER_USERNAME;
  const turnCred = process.env.TURN_SERVER_CREDENTIAL;

  if (turnUser && turnCred) {
    const uniqueTurnUrls = [...new Set(turnUrls.filter((url): url is string => Boolean(url)))];

    if (uniqueTurnUrls.length > 0) {
      servers.push({
        urls: uniqueTurnUrls,
        username: turnUser,
        credential: turnCred,
      });
    }
  }

  const publicTurnUrls = [
    process.env.NEXT_PUBLIC_TURN_URL,
    process.env.NEXT_PUBLIC_TURNS_URL,
    process.env.NEXT_PUBLIC_TURN_IP_URL,
    process.env.NEXT_PUBLIC_TURNS_IP_URL,
  ];
  const publicTurnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const publicTurnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (publicTurnUser && publicTurnCred) {
    const uniquePublicTurnUrls = [
      ...new Set(publicTurnUrls.filter((url): url is string => Boolean(url))),
    ];

    if (uniquePublicTurnUrls.length > 0) {
      // Add public TURN entries as a fallback if server-side TURN envs are not configured
      // in the runtime environment serving SSE.
      const hasMatchingServerTurnEntry = servers.some((server) => {
        if (!('username' in server) || !('credential' in server)) return false;
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => uniquePublicTurnUrls.includes(url));
      });

      if (!hasMatchingServerTurnEntry) {
        servers.push({
          urls: uniquePublicTurnUrls,
          username: publicTurnUser,
          credential: publicTurnCred,
        });
      }
    }
  }

  return servers;
}

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
      token: searchParams.get('token') ?? undefined,
    });

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({ error: parseResult.error.errors[0]?.message ?? 'Invalid parameters' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const { participantId, token } = parseResult.data;

    // Handle authentication - support both cookie-based (web) and token-based (desktop)
    let supabase;
    let user = null;

    if (token) {
      // Desktop app: authenticate with Bearer token from query param
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !key) {
        return new Response(JSON.stringify({ error: 'Server configuration error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      supabase = createSupabaseClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const { data } = await supabase.auth.getUser(token);
      user = data.user;
    } else {
      // Web browser: use cookie-based auth
      supabase = await createClient();
      const authResult = await getAuthenticatedUser(supabase);
      user = authResult.user;
    }

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
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (session.status === 'ended') {
      return new Response(JSON.stringify({ error: 'Session has ended' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Determine the subscriber's ID (for filtering messages)
    const subscriberId = user?.id ?? participantId;
    const isHost = user?.id === session.host_user_id;

    if (!subscriberId && !isHost) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let isStreamClosed = false;
    // Hoist channel reference so cancel() can clean it up
    let channelRef: ReturnType<typeof supabase.channel> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event (includes ICE servers so clients get TURN config)
        const connectEvent = `event: connected\ndata: ${JSON.stringify({ sessionId, subscriberId, isHost, iceServers: getIceServers() })}\n\n`;
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

        // Store channel reference for cancel() cleanup
        channelRef = channel;

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
        if (channelRef) {
          void supabase.removeChannel(channelRef);
        }
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
    console.error('Signal stream error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
