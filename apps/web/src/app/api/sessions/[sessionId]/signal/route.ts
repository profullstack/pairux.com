import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import { z } from 'zod';

// Type for session (until Supabase types are regenerated)
interface Session {
  id: string;
  status: string;
  host_user_id: string | null;
}

// Signal message schema
const signalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice-candidate']),
  sdp: z.string().optional(),
  candidate: z
    .object({
      candidate: z.string(),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    })
    .optional(),
  targetId: z.string().optional(),
  senderId: z.string(),
  timestamp: z.number(),
});

// ICE candidates can legitimately arrive in bursts. Keep a generous
// participant allowance while adding an IP ceiling to stop identity rotation
// from bypassing the limiter.
const signalsBySender = new FixedWindowRateLimiter(120, 60_000);
const signalsByIp = new FixedWindowRateLimiter(300, 60_000);

// POST /api/sessions/[sessionId]/signal - Send a signaling message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const signal = signalSchema.parse(body);

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);

    const senderLimit = signalsBySender.check(`${sessionId}:${signal.senderId}`);
    const ipLimit = signalsByIp.check(getClientIp(request));
    if (!senderLimit.success || !ipLimit.success) {
      return errorResponse('Rate limit exceeded', 429);
    }

    // Verify session exists and is active
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id, status, host_user_id')
      .eq('id', sessionId)
      .single();

    const session = sessionData as Session | null;

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    if (session.status === 'ended') {
      return errorResponse('Session has ended', 410);
    }

    // Verify sender is a participant or the host.
    // For authenticated clients (desktop/web), prefer the authenticated user identity rather
    // than trusting the posted senderId. Some desktop builds may post a local participant UUID
    // while the SSE signaling stream uses a server-assigned subscriber/user ID.
    const isHost = user?.id === session.host_user_id;
    let effectiveSenderId = signal.senderId;

    if (!isHost) {
      // Allow either participant-row IDs (legacy/current web paths) or authenticated user IDs
      // (desktop SSE subscriber IDs can be the auth user ID).
      const { data: participantById } = await supabase
        .from('session_participants')
        .select('id')
        .eq('session_id', sessionId)
        .eq('id', signal.senderId)
        .is('left_at', null)
        .single();

      let isAuthorizedParticipant = Boolean(participantById);

      if (!isAuthorizedParticipant && user?.id && signal.senderId === user.id) {
        const { data: participantByUserId } = await supabase
          .from('session_participants')
          .select('id')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .is('left_at', null)
          .single();

        isAuthorizedParticipant = Boolean(participantByUserId);
      }

      // If the request is authenticated, authorize based on the authenticated user's active
      // participation even when the posted senderId does not match exactly (older desktop clients).
      if (!isAuthorizedParticipant && user?.id) {
        const { data: participantByAuthenticatedUserId } = await supabase
          .from('session_participants')
          .select('id')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .is('left_at', null)
          .single();

        const isAuthenticatedUserParticipant = Boolean(participantByAuthenticatedUserId);
        if (isAuthenticatedUserParticipant) {
          isAuthorizedParticipant = true;
          effectiveSenderId = user.id;
        }
      }

      if (!isAuthorizedParticipant) {
        return errorResponse('Not authorized to send signals in this session', 403);
      }
    }

    // Broadcast the signal via Supabase Realtime
    // Create a server-side channel to broadcast
    const channel = supabase.channel(`session:${sessionId}`);

    // Subscribe and wait for confirmation
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (status === 'SUBSCRIBED') {
          resolve();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel subscription failed: ${status}`));
        }
      });
    });

    await channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: signal.type,
        sdp: signal.sdp,
        candidate: signal.candidate,
        senderId: effectiveSenderId,
        targetId: signal.targetId,
        timestamp: signal.timestamp,
      },
    });

    await supabase.removeChannel(channel);

    return successResponse({ sent: true }, 200);
  } catch (error) {
    return handleApiError(error);
  }
}
