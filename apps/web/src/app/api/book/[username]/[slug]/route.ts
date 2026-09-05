import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import {
  BookingError,
  availableSlots,
  createBooking,
  findActivePage,
  findHostByUsername,
  publicHost,
  publicPage,
} from '@/lib/booking';
import { bookRequestSchema } from '@/lib/booking-validations';

interface RouteParams {
  params: Promise<{ username: string; slug: string }>;
}

/** A guest can look as often as they like; booking is what gets abused. */
const bookingsByIp = new FixedWindowRateLimiter(10, 60 * 60_000);
const bookingsByEmail = new FixedWindowRateLimiter(5, 60 * 60_000);

const MAX_DAYS_PER_REQUEST = 31;

/**
 * GET /api/book/[username]/[slug]?from=YYYY-MM-DD&days=7
 *
 * The slots this page can offer, as instants. `from` is a date in the page's
 * own zone (defaulting to today there); the guest's browser groups the result
 * by its own days. Anonymous.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { username, slug } = await params;
    const { searchParams } = new URL(request.url);

    const from = searchParams.get('from') ?? undefined;
    if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return errorResponse('from must be YYYY-MM-DD', 400);
    }
    const daysRaw = searchParams.get('days');
    const days = daysRaw === null ? 7 : Number(daysRaw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS_PER_REQUEST) {
      return errorResponse(`days must be between 1 and ${String(MAX_DAYS_PER_REQUEST)}`, 400);
    }

    const svc = serviceClient();
    const host = await findHostByUsername(svc, username);
    if (!host) return errorResponse('No such user', 404);
    const page = await findActivePage(svc, host.id, slug);
    if (!page) return errorResponse('No such booking page', 404);

    const slots = await availableSlots(svc, page, from, days);
    return successResponse({
      host: publicHost(host),
      page: publicPage(page),
      from: from ?? null,
      days,
      slots,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/book/[username]/[slug] — take a slot.
 *
 *   { "start": "2026-09-08T16:00:00.000Z", "name": "…", "email": "…", "notes": "…" }
 *
 * Creates the meeting, emails the guest their invite (join code, calendar
 * links, RSVP) and tells the host. 409 when the time has gone since the guest
 * looked. Anonymous, rate-limited by address and by email.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { username, slug } = await params;

    const ip = getClientIp(request);
    const byIp = bookingsByIp.check(ip);
    if (!byIp.success) {
      return errorResponse('Too many bookings from this address. Try again later.', 429);
    }

    const body: unknown = await request.json().catch(() => ({}));
    const input = bookRequestSchema.parse(body);

    const byEmail = bookingsByEmail.check(input.email);
    if (!byEmail.success) {
      return errorResponse('Too many bookings for this email. Try again later.', 429);
    }

    const svc = serviceClient();
    const host = await findHostByUsername(svc, username);
    if (!host) return errorResponse('No such user', 404);
    const page = await findActivePage(svc, host.id, slug);
    if (!page) return errorResponse('No such booking page', 404);

    const booking = await createBooking(svc, host, page, {
      start: input.start,
      name: input.name,
      email: input.email,
      notes: input.notes,
    });
    return successResponse(booking, 201);
  } catch (error) {
    if (error instanceof BookingError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
