/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { bookingPageUpdateSchema } from '@/lib/booking-validations';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH /api/booking-pages/[id] — change any of a page's fields
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const input = bookingPageUpdateSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) update.title = input.title;
    if (input.slug !== undefined) update.slug = input.slug;
    if (input.description !== undefined) update.description = input.description;
    if (input.durationMinutes !== undefined) update.duration_minutes = input.durationMinutes;
    if (input.timezone !== undefined) update.timezone = input.timezone;
    if (input.availability !== undefined) update.availability = input.availability;
    if (input.bufferMinutes !== undefined) update.buffer_minutes = input.bufferMinutes;
    if (input.minNoticeMinutes !== undefined) update.min_notice_minutes = input.minNoticeMinutes;
    if (input.maxDaysAhead !== undefined) update.max_days_ahead = input.maxDaysAhead;
    if (input.active !== undefined) update.active = input.active;

    const { data, error } = await (svc as any)
      .from('booking_pages')
      .update(update)
      .eq('id', id)
      .eq('host_user_id', user.id)
      .select()
      .maybeSingle();

    if (error) {
      if (String(error.code) === '23505') {
        return errorResponse('You already have a page with that slug', 409);
      }
      return errorResponse(String(error.message), 400);
    }
    if (!data) return errorResponse('Booking page not found', 404);

    return successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/booking-pages/[id] — remove a page; meetings already booked stay
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();
    const { data, error } = await (svc as any)
      .from('booking_pages')
      .delete()
      .eq('id', id)
      .eq('host_user_id', user.id)
      .select('id')
      .maybeSingle();

    if (error) return errorResponse(String(error.message), 400);
    if (!data) return errorResponse('Booking page not found', 404);

    return successResponse({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
