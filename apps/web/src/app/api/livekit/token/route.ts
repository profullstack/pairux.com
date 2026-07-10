import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { effectivePlan, maxListeners, type Plan } from '@pairux/shared-types';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getIceServers } from '@/lib/ice-servers';

const tokenRequestSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  participantName: z.string().min(1).max(50),
  participantId: z.string().uuid('Invalid participant ID'),
  isHost: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const { sessionId, participantName, participantId, isHost } = tokenRequestSchema.parse(body);

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return errorResponse('LiveKit not configured', 503);
    }

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // Verify session exists and user is authorized
    const { data: session, error: sessionError } = (await supabase
      .from('sessions')
      .select('id, mode, host_user_id, status')
      .eq('id', sessionId)
      .single()) as {
      data: { id: string; mode: string; host_user_id: string; status: string } | null;
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

    const isSessionOwner = session.host_user_id === user.id;

    // Allow authenticated participants to publish (present/share) without making them host.
    // Host-only moderation remains gated elsewhere by the real session host ID.
    let isParticipant = false;
    if (!isSessionOwner) {
      const { data: participant } = await supabase
        .from('session_participants')
        .select('id')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .is('left_at', null)
        .single();
      isParticipant = Boolean(participant);

      if (!isParticipant) {
        return errorResponse('Not authorized for this session', 403);
      }
    }

    // Enforce the room owner's listener cap once the joiner is authorized. Free
    // rooms hold 5, Plus 100, etc. The host always gets in; additional joiners
    // are rejected once the room is at capacity. join_session already gates the
    // participant path — this is the SFU-side belt-and-suspenders. A lapsed paid
    // plan falls back to the free cap via effectivePlan().
    if (!isSessionOwner) {
      const { data: ownerProfile } = (await supabase
        .from('profiles')
        .select('plan, plan_expires_at')
        .eq('id', session.host_user_id)
        .single()) as { data: { plan: Plan; plan_expires_at: string | null } | null };
      const ownerPlan = effectivePlan(
        ownerProfile?.plan ?? 'free',
        ownerProfile?.plan_expires_at ?? null
      );
      const cap = maxListeners(ownerPlan);

      const { count } = await supabase
        .from('session_participants')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .is('left_at', null);

      const occupancy = count ?? 0;
      if (occupancy >= cap) {
        return errorResponse(`Room is full (${String(occupancy)}/${String(cap)} listeners)`, 403);
      }
    }

    const canPublish = isSessionOwner || isParticipant;
    const effectiveIsHost = isHost && isSessionOwner;

    const roomName = `session-${sessionId}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantId,
      name: participantName,
      ttl: '24h',
      metadata: JSON.stringify({
        role: effectiveIsHost ? 'host' : 'viewer',
        userId: user.id,
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
      iceServers: getIceServers(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
