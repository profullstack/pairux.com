import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { getCliUser } from '@/lib/cli-auth';
import { agentJoinErrorStatus, agentJoinSchema } from '@/lib/agents';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import type { SessionParticipant } from '@pairux/shared-types';

const joinsByIp = new FixedWindowRateLimiter(10, 60_000);

/**
 * POST /api/v1/agents/join — an AI agent joins a session by join code.
 *
 * Body: { joinCode, name, client? }. A signed-in CLI (Bearer pux_at_...) is
 * recorded as the agent's owner so the host can see whose agent it is;
 * anonymous agents are allowed on the same terms as guests. Returns the
 * participant id, which the agent uses for every later call.
 */
export async function POST(request: Request) {
  try {
    if (!joinsByIp.check(getClientIp(request)).success) {
      return errorResponse('Too many agent joins. Try again in a minute.', 429);
    }

    const body = agentJoinSchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();
    const owner = await getCliUser(db, request);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (db.rpc as any)('join_session_as_agent', {
      p_join_code: body.joinCode,
      p_display_name: body.name,
      p_agent_client: body.client ?? null,
      p_owner_id: owner?.userId ?? null,
    });

    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const message = String(error.message ?? 'Could not join');
      return errorResponse(message, agentJoinErrorStatus(message));
    }

    const participant = data as SessionParticipant;
    return successResponse(
      {
        participantId: participant.id,
        sessionId: participant.session_id,
        displayName: participant.display_name,
        owned: owner !== null,
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
