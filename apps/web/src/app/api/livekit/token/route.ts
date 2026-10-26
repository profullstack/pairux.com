import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getIceServers } from '@/lib/ice-servers';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import { ROOM_FULL_MESSAGE, recordCapRefusal } from '@/lib/room-cap';
import type { SeatKind } from '@pairux/shared-types';

// A token is valid for 24 hours, so legitimate clients never need to mint
// them rapidly. These limits protect the database and LiveKit from connection
// churn while still leaving generous headroom for reconnects.
const tokenRequestsByIp = new FixedWindowRateLimiter(60, 60_000);
const tokenRequestsByParticipant = new FixedWindowRateLimiter(20, 60_000);

const tokenRequestSchema = z.object({
  sessionId: z.guid('Invalid session ID'),
  participantName: z.string().min(1).max(50),
  participantId: z.guid('Invalid participant ID'),
  isHost: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const ipLimit = tokenRequestsByIp.check(getClientIp(request));
    if (!ipLimit.success) {
      return errorResponse(
        `Too many token requests. Try again in ${String(ipLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const body: unknown = await request.json().catch(() => ({}));
    const { sessionId, participantName, participantId, isHost } = tokenRequestSchema.parse(body);

    const participantLimit = tokenRequestsByParticipant.check(`${sessionId}:${participantId}`);
    if (!participantLimit.success) {
      return errorResponse(
        `Too many connection attempts. Try again in ${String(participantLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return errorResponse('LiveKit not configured', 503);
    }

    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    // Server-side authorization uses the service client for reads (guests have
    // no RLS session access); every access decision below is explicit.
    const svc = serviceClient();

    // Verify session exists and gather what authorization needs.
    const { data: session, error: sessionError } = (await svc
      .from('sessions')
      .select('id, mode, host_user_id, status, is_public, current_host_id')
      .eq('id', sessionId)
      .single()) as {
      data: {
        id: string;
        mode: string;
        host_user_id: string;
        status: string;
        is_public: boolean;
        current_host_id: string | null;
      } | null;
      error: unknown;
    };

    if (sessionError || !session) {
      return errorResponse('Session not found', 404);
    }

    if (session.mode !== 'sfu') {
      return errorResponse('Session is not in SFU mode', 400);
    }

    if (session.status === 'ended') {
      return errorResponse('Session has ended', 400);
    }

    const isSessionOwner = Boolean(user) && session.host_user_id === user?.id;

    // Authorize the joiner:
    //  • owner  → always in (may publish/host).
    //  • authed non-owner → must hold a live participant row (may publish).
    //  • GUEST (logged out) → may WATCH a PUBLIC, currently-live room only,
    //    authorized by their participantId (session_participants.id from
    //    join_session); subscribe-only, never publishes.
    let isParticipant = false;
    let isGuest = false;
    let seatRowId: string | null = null;
    if (!isSessionOwner) {
      if (user) {
        const { data: participant } = await svc
          .from('session_participants')
          .select('id')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .is('left_at', null)
          .maybeSingle();
        isParticipant = Boolean(participant);
        if (!isParticipant) {
          return errorResponse('Not authorized for this session', 403);
        }
        seatRowId = (participant as unknown as { id: string }).id;
      } else {
        if (!session.is_public || !session.current_host_id) {
          return errorResponse('Sign in to join this room', 401);
        }
        const { data: participant } = await svc
          .from('session_participants')
          .select('id')
          .eq('id', participantId)
          .eq('session_id', sessionId)
          .is('left_at', null)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- maybeSingle() can return null
        if (!participant) {
          return errorResponse('Not authorized for this session', 403);
        }
        isGuest = true;
        seatRowId = participantId;
      }
    }

    // Seats on the owner's plan, right now: a signed-in joiner takes a
    // participant seat (Free: 2, the host's included), a guest here takes a
    // listener seat (SFU tokens for guests are subscribe-only; Free: 20).
    // join_session already seated this row; claim_session_seat only refuses a
    // row that went quiet and finds the room full meanwhile, so nobody still
    // in the call is ever cut off by a token refresh. The host always gets in.
    if (seatRowId) {
      const { data: seat } = (await svc.rpc(
        'claim_session_seat' as never,
        {
          p_session_id: sessionId,
          p_participant_id: seatRowId,
        } as never
      )) as { data: string | null };
      if (seat === 'participants' || seat === 'listeners') {
        await recordCapRefusal(svc, sessionId, seat satisfies SeatKind);
        return errorResponse(ROOM_FULL_MESSAGE, 403);
      }
      if (seat === 'gone') {
        return errorResponse('Not authorized for this session', 403);
      }
    }

    // Guests never publish media — watch-only.
    const canPublish = isSessionOwner || isParticipant;
    const effectiveIsHost = isHost && isSessionOwner;

    const roomName = `session-${sessionId}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantId,
      name: participantName,
      ttl: '24h',
      metadata: JSON.stringify({
        role: effectiveIsHost ? 'host' : isGuest ? 'guest' : 'viewer',
        userId: user?.id ?? null,
      }),
    });

    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    };

    token.addGrant(grant);

    const jwt = await token.toJwt();

    return successResponse({
      token: jwt,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      roomName,
      iceServers: await getIceServers(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
