import { z } from 'zod';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getIceServers } from '@/lib/ice-servers';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';

interface RouteParams {
  params: Promise<{ participantId: string }>;
}

const idSchema = z.guid('Invalid participant ID');
const tokensByIp = new FixedWindowRateLimiter(30, 60_000);
const tokensByParticipant = new FixedWindowRateLimiter(12, 60_000);

/**
 * POST /api/v1/agents/[participantId]/voice-token
 *
 * The random participant id is the agent's existing CLI capability. A live
 * agent can mint a session-scoped LiveKit token for microphone audio only.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ipLimit = tokensByIp.check(getClientIp(request));
    if (!ipLimit.success) {
      return errorResponse(
        `Too many voice token requests. Try again in ${String(ipLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const participantId = idSchema.parse((await params).participantId);
    const participantLimit = tokensByParticipant.check(participantId);
    if (!participantLimit.success) {
      return errorResponse(
        `Too many voice token requests. Try again in ${String(participantLimit.retryAfterSeconds)} seconds.`,
        429
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) return errorResponse('LiveKit not configured', 503);

    const db = serviceClient();
    const { data: participant } = (await db
      .from('session_participants')
      .select('id, session_id, display_name, kind, left_at, agent_owner_id')
      .eq('id', participantId)
      .maybeSingle()) as {
      data: {
        id: string;
        session_id: string;
        display_name: string;
        kind: string;
        left_at: string | null;
        agent_owner_id: string | null;
      } | null;
    };

    if (participant?.kind !== 'agent') return errorResponse('Agent not found', 404);
    if (participant.left_at) return errorResponse('This agent has left or was removed', 410);

    const { data: session } = (await db
      .from('sessions')
      .select('id, mode, status')
      .eq('id', participant.session_id)
      .maybeSingle()) as {
      data: { id: string; mode: string; status: string } | null;
    };
    if (!session) return errorResponse('Session not found', 404);
    if (session.status === 'ended') return errorResponse('The session has ended', 410);
    if (session.mode !== 'sfu') {
      return errorResponse('Voice CLI requires a session running in SFU mode', 409);
    }

    const roomName = `session-${session.id}`;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: participant.id,
      name: participant.display_name,
      ttl: '24h',
      metadata: JSON.stringify({ role: 'agent', userId: participant.agent_owner_id }),
    });
    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: false,
    };
    token.addGrant(grant);

    return successResponse({
      token: await token.toJwt(),
      url,
      roomName,
      iceServers: await getIceServers(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
