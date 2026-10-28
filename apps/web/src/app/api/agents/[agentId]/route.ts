import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { AccountAgents, AgentAccessError } from '@/lib/account-agents';
import { requestUser } from '@/lib/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ agentId: string }>;
}

// POST /api/agents/:id — { action: "rotate" }: a new key (shown once); the old one stops working.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { agentId } = await params;
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in to manage your agents.', 401);
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action !== 'rotate') return errorResponse('Unknown action.', 400);
    return successResponse(await new AccountAgents().rotate(user.id, agentId));
  } catch (error) {
    if (error instanceof AgentAccessError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}

// DELETE /api/agents/:id — remove the agent; its key stops working and open invites expire.
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { agentId } = await params;
    const user = await requestUser(request);
    if (!user) return errorResponse('Sign in to manage your agents.', 401);
    await new AccountAgents().revoke(user.id, agentId);
    return successResponse({ removed: true });
  } catch (error) {
    if (error instanceof AgentAccessError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
