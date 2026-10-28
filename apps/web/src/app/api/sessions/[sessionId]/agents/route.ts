/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { errorResponse, successResponse } from '@/lib/api';
import { AccountAgents } from '@/lib/account-agents';
import { authorizeCopilotCaller } from '@/lib/copilot/access';
import { body, copilotError, runtimeOrThrow } from '@/lib/copilot/http';
import { serviceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/sessions/:id/agents — the agents you can invite into this meeting
// (yours and your orgs'), each with its invite status, plus how to invite any
// other agent (join code, CLI command, API).
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const caller = await authorizeCopilotCaller(request, sessionId);
    const agents = new AccountAgents();
    const [mine, invites, session] = await Promise.all([
      agents.visibleTo(caller.userId),
      agents.invitesForSession(sessionId),
      (serviceClient() as any)
        .from('sessions')
        .select('join_code')
        .eq('id', sessionId)
        .maybeSingle() as Promise<{ data: { join_code: string } | null }>,
    ]);
    const joinCode = session.data?.join_code ?? '';
    return successResponse({
      agents: mine.map((agent) => {
        const invite = invites.find((one) => one.agentId === agent.id);
        return {
          id: agent.id,
          name: agent.name,
          handle: agent.handle,
          description: agent.description,
          online: agent.online,
          invite: invite ? { id: invite.id, status: invite.status } : null,
        };
      }),
      any: {
        joinCode,
        command: `pairux join ${joinCode} --name "My agent"`,
        api: 'POST https://pairux.com/api/v1/agents/join {"joinCode","name","client"}',
      },
    });
  } catch (error) {
    return copilotError(error);
  }
}

// POST /api/sessions/:id/agents — invite one of your agents: { agentId }.
// It joins as soon as it picks up the invite; with a Pro/Team inviter it also
// gets the live transcript.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const input = await body(request);
    const caller = await authorizeCopilotCaller(request, sessionId);
    if (caller.sessionStatus === 'ended') return errorResponse('This meeting has ended.', 400);
    const agents = new AccountAgents();
    const agent = await agents.get(typeof input.agentId === 'string' ? input.agentId : '');
    if (!agent || !(await agents.canUse(caller.userId, agent)))
      return errorResponse('Agent not found', 404);
    const transcript = await runtimeOrThrow().accounts.eligible(caller.userId);
    const invite = await agents.invite({
      agentId: agent.id,
      sessionId,
      invitedBy: caller.userId,
      transcript,
    });
    return successResponse({ invite, agent: { id: agent.id, name: agent.name }, transcript }, 201);
  } catch (error) {
    return copilotError(error);
  }
}
