import { z } from 'zod';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import {
  AGENT_STALE_MS,
  agentPollSchema,
  type AgentChatMessage,
  type AgentRosterEntry,
} from '@/lib/agents';

interface RouteParams {
  params: Promise<{ participantId: string }>;
}

const idSchema = z.string().uuid('Invalid participant ID');

interface AgentRow {
  id: string;
  session_id: string;
  display_name: string;
  kind: string;
  left_at: string | null;
}

async function loadAgent(
  db: ReturnType<typeof serviceClient>,
  participantId: string
): Promise<AgentRow | null> {
  const { data } = (await db
    .from('session_participants')
    .select('id, session_id, display_name, kind, left_at')
    .eq('id', participantId)
    .eq('kind', 'agent')
    .maybeSingle()) as { data: AgentRow | null };
  return data;
}

/**
 * GET /api/v1/agents/[participantId]?after=<ISO time>
 *
 * The agent's single polling call. It doubles as the heartbeat (stamps
 * last_seen_at) and returns everything an agent needs to follow the room:
 * session status, who is here, and public chat newer than `after`.
 * 410 means the agent was removed by the host or the session ended.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const participantId = idSchema.parse((await params).participantId);
    const { searchParams } = new URL(request.url);
    const { after } = agentPollSchema.parse({ after: searchParams.get('after') ?? undefined });

    const db = serviceClient();
    const agent = await loadAgent(db, participantId);
    if (!agent) return errorResponse('Agent not found', 404);
    if (agent.left_at)
      return errorResponse('This agent has left or was removed from the session', 410);

    const { data: session } = (await db
      .from('sessions')
      .select('id, status, subject, join_code')
      .eq('id', agent.session_id)
      .single()) as {
      data: { id: string; status: string; subject: string | null; join_code: string } | null;
    };
    if (!session) return errorResponse('Session not found', 404);
    if (session.status === 'ended') return errorResponse('The session has ended', 410);

    const now = new Date();
    await db
      .from('session_participants')
      .update({ last_seen_at: now.toISOString(), connection_status: 'connected' } as never)
      .eq('id', agent.id);

    // Agents whose CLI died never call leave; retire them so rosters stay honest.
    await db
      .from('session_participants')
      .update({ left_at: now.toISOString(), connection_status: 'disconnected' } as never)
      .eq('session_id', agent.session_id)
      .eq('kind', 'agent')
      .is('left_at', null)
      .lt('last_seen_at', new Date(now.getTime() - AGENT_STALE_MS).toISOString());

    const { data: participants } = (await db
      .from('session_participants')
      .select('id, display_name, role, kind, agent_client, control_state')
      .eq('session_id', agent.session_id)
      .is('left_at', null)
      .order('joined_at', { ascending: true })) as { data: AgentRosterEntry[] | null };

    let messageQuery = db
      .from('chat_messages')
      .select('id, display_name, content, message_type, created_at')
      .eq('session_id', agent.session_id)
      .is('recipient_id', null)
      .order('created_at', { ascending: true })
      .limit(100);
    if (after) messageQuery = messageQuery.gt('created_at', after);
    const { data: messages } = (await messageQuery) as { data: AgentChatMessage[] | null };

    return successResponse({
      you: { id: agent.id, displayName: agent.display_name },
      session: {
        id: session.id,
        status: session.status,
        subject: session.subject,
        joinCode: session.join_code,
      },
      participants: participants ?? [],
      messages: messages ?? [],
      serverTime: now.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE /api/v1/agents/[participantId] — the agent leaves the session. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const participantId = idSchema.parse((await params).participantId);
    const db = serviceClient();
    const agent = await loadAgent(db, participantId);
    if (!agent) return errorResponse('Agent not found', 404);

    if (!agent.left_at) {
      await db
        .from('session_participants')
        .update({
          left_at: new Date().toISOString(),
          connection_status: 'disconnected',
        } as never)
        .eq('id', agent.id);
    }
    return successResponse({ left: true, participantId: agent.id });
  } catch (error) {
    return handleApiError(error);
  }
}
