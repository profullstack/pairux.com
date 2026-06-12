import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getEgressClient } from '@/lib/livekit-egress';

/** Stop a server-side RTMP restream started via /api/stream/egress/start. */

interface StopEgressBody {
  egressId: string;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as Partial<StopEgressBody>;
    const egressId = typeof body.egressId === 'string' ? body.egressId : '';
    if (!egressId) {
      return errorResponse('egressId is required', 400);
    }

    const egress = getEgressClient();
    if (!egress) {
      return errorResponse('Server-side streaming is not configured', 503);
    }

    await egress.stopEgress(egressId);
    return successResponse({ stopped: true });
  } catch (error) {
    return handleApiError(error);
  }
}
