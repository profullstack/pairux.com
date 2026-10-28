import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { AccountAgents, AgentAccessError, registerAgentSchema } from '@/lib/account-agents';
import { requestUser } from '@/lib/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agents — your own agents and those shared with your orgs.
export async function GET(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in to manage your agents.', 401);
    const agents = await new AccountAgents().visibleTo(user.id);
    return successResponse({
      agents: agents.map((agent) => ({ ...agent, mine: agent.ownerUserId === user.id })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/agents — register an agent: { name, handle, description?, orgId? }.
// Answers the agent and its key; the key is shown this once.
export async function POST(request: Request) {
  try {
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in to manage your agents.', 401);
    const input = registerAgentSchema.parse(await request.json().catch(() => ({})));
    return successResponse(await new AccountAgents().register(user.id, input), 201);
  } catch (error) {
    if (error instanceof AgentAccessError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
