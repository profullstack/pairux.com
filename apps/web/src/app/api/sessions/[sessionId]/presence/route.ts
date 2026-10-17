import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const bodySchema = z.object({
  // Guests send their participant row id. Signed-in viewers may send a local
  // id that is not a row; claim_session_seat then falls back to their user.
  participantId: z.string().uuid().optional(),
});

// Clients ping every 30 s; this leaves room for a few tabs behind one address.
const pingsByIpAndSession = new FixedWindowRateLimiter(30, 60_000);

/**
 * POST /api/sessions/[sessionId]/presence
 *
 * A viewer's "still here", every 30 s. A participant row holds its plan seat
 * only while it has been seen in the last 3 minutes (SEAT_PRESENCE_SECONDS),
 * so a tab that closed without leaving frees its seat on its own.
 *
 * Answers { seat }: 'ok', 'participants' / 'listeners' (the row went quiet and
 * that kind of seat filled up meanwhile; nobody is removed, the client just
 * does not hold a seat), or 'gone' (no active row).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    if (!z.string().uuid().safeParse(sessionId).success) {
      return errorResponse('Invalid session id', 400);
    }
    const limit = pingsByIpAndSession.check(`${getClientIp(request)}:${sessionId}`);
    if (!limit.success) {
      return errorResponse('Too many presence pings', 429);
    }
    const body: unknown = await request.json().catch(() => ({}));
    const { participantId } = bodySchema.parse(body);

    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('claim_session_seat', {
      p_session_id: sessionId,
      p_participant_id: participantId ?? null,
    });
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      return errorResponse(error.message, 400);
    }

    return successResponse({ seat: typeof data === 'string' ? data : 'gone' });
  } catch (error) {
    return handleApiError(error);
  }
}
