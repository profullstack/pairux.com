import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const bodySchema = z.object({
  // Guests send their participant row id. Signed-in viewers may send a local
  // id that is not a row; mark_media_connected then falls back to their user.
  participantId: z.guid().optional(),
});

/**
 * POST /api/sessions/[sessionId]/connected
 *
 * A viewer calls this once its <video> is playing frames from the host. It is
 * the activation signal: sessions.connected_at (first connected viewer),
 * session_participants.media_connected_at, and status 'active'. Two
 * participant rows alone do not prove anything reached the screen.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    if (!z.guid().safeParse(sessionId).success) {
      return errorResponse('Invalid session id', 400);
    }
    const body: unknown = await request.json().catch(() => ({}));
    const { participantId } = bodySchema.parse(body);

    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('mark_media_connected', {
      p_session_id: sessionId,
      p_participant_id: participantId ?? null,
    });
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }
    if (data !== true) {
      return errorResponse('Not an active viewer of this session', 403);
    }

    return successResponse({ connected: true });
  } catch (error) {
    return handleApiError(error);
  }
}
