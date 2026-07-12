import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import type { GoLiveFlip } from '@/lib/notify-live';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/sessions/[sessionId]/heartbeat
 *
 * The active host pings this while live. It stamps sessions.host_last_seen_at,
 * which the /live directory uses to decide a room is still live — so a killed or
 * crashed host (which never runs host_leave_session) falls off /live once its
 * pings stop. Host-only, enforced by the host_heartbeat RPC.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('host_heartbeat', {
      p_session_id: sessionId,
    });
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    // If this heartbeat is the moment the (public) room went live, notify the
    // host's followers — exactly once (mark_room_went_live dedupes atomically).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data: flip } = await (supabase.rpc as any)('mark_room_went_live', {
      p_session_id: sessionId,
    });
    const live = (Array.isArray(flip) ? flip[0] : null) as GoLiveFlip | null;
    if (live?.creator_id) {
      void import('@/lib/notify-live').then(({ notifyFollowersLive }) =>
        notifyFollowersLive(live.creator_id, live.subject ?? null, live.join_code)
      );
    }

    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
