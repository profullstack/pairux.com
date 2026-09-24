/**
 * Agent participants: AI agents (Claude Code, moshcode, scripts) that join a
 * PairUX session through the CLI or the /api/v1/agents API.
 *
 * An agent is a watch-only viewer row with kind = 'agent'. Like a guest, the
 * participant id it gets back from join is its credential for everything
 * after: polling the room, chatting, leaving. It never publishes media or
 * takes control. The host sees it badged as an agent on every surface and can
 * remove it like anyone else.
 */
import { z } from 'zod';

/** An agent that has not polled for this long is treated as gone. */
export const AGENT_STALE_MS = 2 * 60 * 1000;

export const agentJoinSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{6}$/, 'Join code must be 6 letters or digits'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  client: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, 'client must be a short slug like "claude-code"')
    .optional(),
});

export const agentMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(500),
});

export const agentPollSchema = z.object({
  after: z.string().datetime({ offset: true }).optional(),
});

/** Map a join_session_as_agent exception to an HTTP status. */
export function agentJoinErrorStatus(message: string): number {
  if (message.includes('not found or has ended')) return 404;
  if (message.includes('not accepting agents')) return 403;
  if (message.includes('maximum number of agents')) return 409;
  if (message.includes('Display name')) return 400;
  return 400;
}

export interface AgentRosterEntry {
  id: string;
  display_name: string;
  role: string;
  kind: string;
  agent_client: string | null;
  control_state: string;
}

export interface AgentChatMessage {
  id: string;
  display_name: string;
  content: string;
  message_type: string;
  created_at: string;
}
