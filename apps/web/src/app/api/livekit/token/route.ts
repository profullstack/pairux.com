import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { effectivePlan, maxListeners, type Plan } from '@pairux/shared-types';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
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
      }
    }

    // Enforce the owner's plan cap on AUTHENTICATED joiners only. Watch-only
    // GUESTS are unlimited (they only subscribe), so they neither hit the cap
    // nor count toward it — the occupancy count excludes guests (user_id NULL).
    // The host always gets in. A lapsed paid plan falls back to the free cap.
    if (!isSessionOwner && !isGuest) {
      const { data: ownerProfile } = (await svc
        .from('profiles')
        .select('plan, plan_expires_at')
        .eq('id', session.host_user_id)
        .single()) as { data: { plan: Plan; plan_expires_at: string | null } | null };
      const ownerPlan = effectivePlan(
        ownerProfile?.plan ?? 'free',
        ownerProfile?.plan_expires_at ?? null
      );
      const cap = maxListeners(ownerPlan);

      const { count } = await svc
        .from('session_participants')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .is('left_at', null)
        .not('user_id', 'is', null);

      const occupancy = count ?? 0;
      if (occupancy >= cap) {
        return errorResponse(`Room is full (${String(occupancy)}/${String(cap)} listeners)`, 403);
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
