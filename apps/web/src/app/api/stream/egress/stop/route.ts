import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getEgressClient } from '@/lib/livekit-egress';

/** Stop a server-side RTMP restream started via /api/stream/egress/start. */

interface StopEgressBody {
  /** Single id (legacy) and/or the full set started for a session. */
  egressId?: string;
  egressIds?: string[];
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as StopEgressBody;
    const ids = [
      ...(Array.isArray(body.egressIds) ? body.egressIds : []),
      ...(typeof body.egressId === 'string' ? [body.egressId] : []),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return errorResponse('egressId or egressIds is required', 400);
    }

    const egress = getEgressClient();
    if (!egress) {
      return errorResponse('Server-side streaming is not configured', 503);
    }

    // Stop every destination's egress; one failure must not abandon the rest.
    await Promise.allSettled(uniqueIds.map((id) => egress.stopEgress(id)));
    return successResponse({ stopped: true });
  } catch (error) {
    return handleApiError(error);
  }
}
