/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { bookingPageInputSchema, slugify } from '@/lib/booking-validations';

/**
 * /api/booking-pages — the host's side of booking.
 *
 * A page is availability plus a duration under a slug. The public half
 * (/api/book/<username>/<slug>) reads what is created here; nothing a guest
 * does reaches this route.
 */

const MAX_PAGES_PER_HOST = 20;

// GET /api/booking-pages — every page this host owns, active or not
export async function GET() {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();
    const { data, error } = await (svc as any)
      .from('booking_pages')
      .select('*')
      .eq('host_user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) return errorResponse(String(error.message), 400);

    const { data: profile } = await (svc as any)
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    return successResponse({
      username: (profile?.username as string | null) ?? null,
      pages: (data as unknown[] | null) ?? [],
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/booking-pages — create a page
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const input = bookingPageInputSchema.parse(body);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Authentication required', 401);

    const svc = serviceClient();

    // A page is reached by username, so a host without one has nowhere to be
    // booked. Say so up front rather than creating a page nobody can open.
    const { data: profile } = await (svc as any)
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.username) {
      return errorResponse(
        'Set a username in Settings first — your booking link is /book/<username>/<slug>',
        400
      );
    }

    const { count } = await (svc as any)
      .from('booking_pages')
      .select('id', { count: 'exact', head: true })
      .eq('host_user_id', user.id);
    if ((count as number | null) !== null && (count as number) >= MAX_PAGES_PER_HOST) {
      return errorResponse(`You already have ${String(MAX_PAGES_PER_HOST)} booking pages`, 400);
    }

    const slug = input.slug ?? slugify(input.title);

    const { data, error } = await (svc as any)
      .from('booking_pages')
      .insert({
        host_user_id: user.id,
        slug,
        title: input.title,
        description: input.description ?? null,
        duration_minutes: input.durationMinutes,
        timezone: input.timezone,
        availability: input.availability,
        buffer_minutes: input.bufferMinutes,
        min_notice_minutes: input.minNoticeMinutes,
        max_days_ahead: input.maxDaysAhead,
        active: input.active,
      })
      .select()
      .single();

    if (error) {
      if (String(error.code) === '23505') {
        return errorResponse(`You already have a page at /${slug} — pick another slug`, 409);
      }
      return errorResponse(String(error.message), 400);
    }

    return successResponse({ ...data, url: `/book/${profile.username as string}/${slug}` }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
