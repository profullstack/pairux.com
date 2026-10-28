import { errorResponse, handleApiError, successResponse } from '@/lib/api';
import { AccountAgents } from '@/lib/account-agents';
import { agentJoinErrorStatus } from '@/lib/agents';
import { copilotRuntime } from '@/lib/copilot/runtime';
import { serviceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ inviteId: string }>;
}

// POST /api/v1/agent/invites/:id — { action: "accept" | "decline" } (Bearer pux_ag_...).
// Accepting joins the meeting as an agent participant owned by the agent's
// account and answers its participant id: from then on the agent uses the
// /api/v1/agents/:participantId routes (poll, chat, leave). An invite from a
// Pro/Team inviter also opens the transcript (poll with ?transcriptCursor=0).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { inviteId } = await params;
    const agents = new AccountAgents();
    const agent = await agents.fromRequest(request);
    if (!agent) return errorResponse('Send Authorization: Bearer <pux_ag_ agent key>.', 401);
    const invite = await agents.getInvite(inviteId, agent.id);
    if (!invite) return errorResponse('Invite not found', 404);
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action === 'decline') {
      if (invite.status === 'pending') await agents.setInvite(invite.id, { status: 'declined' });
      return successResponse({ status: 'declined' });
    }
    if (body.action !== 'accept') return errorResponse('action must be accept or decline', 400);
    if (invite.status === 'accepted' && invite.participant_id)
      return successResponse({
        participantId: invite.participant_id,
        sessionId: invite.session_id,
        transcript: invite.transcript,
      });
    if (invite.status !== 'pending' || !invite.sessions || invite.sessions.status === 'ended')
      return errorResponse('This invite is no longer open.', 410);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient().rpc as any)('join_session_as_agent', {
      p_join_code: invite.sessions.join_code,
      p_display_name: agent.name,
      p_agent_client: agent.handle,
      p_owner_id: agent.ownerUserId,
    });
    if (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const message = String(error.message ?? 'Could not join');
      return errorResponse(message, agentJoinErrorStatus(message));
    }
    const participantId = (data as { id: string }).id;
    await agents.setInvite(invite.id, { status: 'accepted', participant_id: participantId });
    if (invite.transcript)
      await copilotRuntime()
        ?.tap(invite.session_id, participantId, agent.name, invite.invited_by)
        .catch((tapError: unknown) => {
          console.warn('[agents] transcript tap failed:', tapError);
        });
    return successResponse(
      { participantId, sessionId: invite.session_id, transcript: invite.transcript },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
