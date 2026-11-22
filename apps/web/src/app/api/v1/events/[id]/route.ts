import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { SITE_URL } from '@/lib/embed';
import { deleteEvent, getMyEvent, LiveEventError, updateEvent } from '@/lib/live-events/store';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { requestUser } from '@/lib/request-user';
import { serviceClient } from '@/lib/supabase/service';
import { liveEventUpdateSchema } from '@/lib/validations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const writesByUser = new FixedWindowRateLimiter(60, 60_000);

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET / PATCH / DELETE /api/v1/events/<id>: one of your live events. DELETE cancels it. */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Authentication required', 401);
    const { id } = await params;
    return successResponse(await getMyEvent(serviceClient(), user.id, id, SITE_URL));
  } catch (error) {
    if (error instanceof LiveEventError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Authentication required', 401);
    if (!writesByUser.check(user.id).success) return errorResponse('Too many requests', 429);
    const { id } = await params;
    const input = liveEventUpdateSchema.parse(await request.json().catch(() => ({})));
    return successResponse(await updateEvent(serviceClient(), user.id, id, input, SITE_URL));
  } catch (error) {
    if (error instanceof LiveEventError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Authentication required', 401);
    if (!writesByUser.check(user.id).success) return errorResponse('Too many requests', 429);
    const { id } = await params;
    return successResponse(await deleteEvent(serviceClient(), user.id, id));
  } catch (error) {
    if (error instanceof LiveEventError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
