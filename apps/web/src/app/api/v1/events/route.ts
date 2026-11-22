import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { SITE_URL } from '@/lib/embed';
import { createEvent, listMyEvents, LiveEventError } from '@/lib/live-events/store';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { liveEventCreateSchema } from '@/lib/validations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const writesByUser = new FixedWindowRateLimiter(60, 60_000);

/**
 * GET  /api/v1/events  your live events (scheduled meetings on a channel)
 * POST /api/v1/events  {title, startsAt, channel, durationMinutes?, repeat?, every?, times?, description?, visibility?}
 *
 * Auth: `pairux login` token (Bearer pux_at_...), a Supabase access token, or
 * the web session. `visibility` defaults to public: the event is listed on the
 * channel page and in /c/<handle>/calendar.ics.
 */
export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Authentication required', 401);
    return successResponse(await listMyEvents(serviceClient(), user.id, SITE_URL));
  } catch (error) {
    if (error instanceof LiveEventError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Authentication required', 401);
    if (!writesByUser.check(user.id).success) return errorResponse('Too many requests', 429);
    const input = liveEventCreateSchema.parse(await request.json().catch(() => ({})));
    return successResponse(await createEvent(serviceClient(), user.id, input, SITE_URL), 201);
  } catch (error) {
    if (error instanceof LiveEventError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
