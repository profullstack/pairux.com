import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import { authenticatePartner } from '@/lib/partners';
import {
  PartnerSessionError,
  createPartnerSession,
  partnerSessionSchema,
} from '@/lib/partner-sessions';

/**
 * POST /api/v1/partner/sessions: a partner's SERVER opens an ordinary PairUX
 * session (desktop app and web/PWA join it with the returned link) and seats
 * its own agents in it. See src/lib/partner-sessions.ts.
 *
 *   Authorization: Bearer pux_pk_…
 *   { "subject": "Board meeting", "agents": [{ "name": "Chair" }], "guestsCanSpeak": true, "recorded": true }
 *   -> 201 { sessionId, joinCode, joinUrl, roomName, agents: [{ participantId, name }] }
 *
 * Each agent then speaks with POST /api/v1/agents/:participantId/voice-token and
 * follows the room (roster, chat, heartbeat) with GET /api/v1/agents/:participantId.
 */
const byIp = new FixedWindowRateLimiter(30, 60_000);
const byPartner = new FixedWindowRateLimiter(30, 60_000);

export async function POST(request: Request) {
  try {
    if (!byIp.check(getClientIp(request)).success) return errorResponse('Too many requests', 429);
    const partner = authenticatePartner(request);
    if (!partner) return errorResponse('Unknown or missing partner key', 401);
    if (!partner.ownerUserId) return errorResponse('This partner cannot open sessions', 403);
    if (!byPartner.check(partner.id).success) {
      return errorResponse('Too many sessions this minute', 429);
    }

    const input = partnerSessionSchema.parse(await request.json().catch(() => ({})));
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
    const session = await createPartnerSession(serviceClient(), partner, input, origin);
    return successResponse(session, 201);
  } catch (error) {
    if (error instanceof PartnerSessionError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
