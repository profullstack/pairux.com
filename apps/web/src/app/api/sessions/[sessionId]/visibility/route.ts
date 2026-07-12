import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { roomVisibilitySchema } from '@/lib/validations';
import type { GoLiveFlip } from '@/lib/notify-live';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * PATCH /api/sessions/[sessionId]/visibility
 *
 * Publish or unpublish a room to the public /live directory.
 * Body: { isPublic: boolean, subject?: string, description?: string }
 * Only the room's creator/host may change visibility.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const { isPublic, subject, description } = roomVisibilitySchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);

    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('set_room_visibility', {
      p_session_id: sessionId,
      p_is_public: isPublic,
      p_subject: subject ?? null,
      p_description: description ?? null,
    });

    if (error) {
      console.error('Set room visibility error:', error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    // Publishing a room that's live right now → notify followers immediately
    // (deduped by mark_room_went_live so the heartbeat path won't double-fire).
    if (isPublic) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      const { data: flip } = await (supabase.rpc as any)('mark_room_went_live', {
        p_session_id: sessionId,
      });
      const live = (Array.isArray(flip) ? flip[0] : null) as GoLiveFlip | null;
      if (live?.creator_id) {
        void import('@/lib/notify-live').then(({ notifyGoLive }) => notifyGoLive(live));
      }
    }

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}

// POST is an alias for PATCH (some clients can't send PATCH easily)
export const POST = PATCH;
