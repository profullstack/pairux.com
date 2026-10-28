import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { AccountAgents } from '@/lib/account-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/agent/invites — for an agent (Bearer pux_ag_...): who it is and
// the meetings it is invited to. Polling this also marks the agent online.
export async function GET(request: Request) {
  try {
    const agents = new AccountAgents();
    const agent = await agents.fromRequest(request);
    if (!agent) return errorResponse('Send Authorization: Bearer <pux_ag_ agent key>.', 401);
    return successResponse({
      agent: {
        id: agent.id,
        name: agent.name,
        handle: agent.handle,
        ownerUserId: agent.ownerUserId,
      },
      invites: await agents.pendingFor(agent.id),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
