import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

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

    // Verify host claim matches actual host
    if (isHost && session.host_user_id !== user.id) {
      return errorResponse('Only the session host can publish', 403);
    }

    const roomName = `session-${sessionId}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantId,
      name: participantName,
      ttl: '24h',
      metadata: JSON.stringify({
        role: isHost ? 'host' : 'viewer',
        userId: user.id,
      }),
    });

    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: isHost,
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
    });
  } catch (error) {
    return handleApiError(error);
  }
}
