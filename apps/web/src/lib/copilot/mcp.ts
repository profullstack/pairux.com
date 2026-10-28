import type { CopilotState } from '@pairux/meeting-copilot/types';
import { writeFollowUps, writeReview } from './agent';
import type { CopilotRuntime } from './runtime';

/**
 * PairUX MCP tools (Streamable HTTP, JSON responses, no SSE): the AI copilot's
 * notes and live asks for agents and editors. Auth is the same Bearer as the
 * rest of /api/v1 (a `pairux login` CLI token).
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MCP_TOOLS = [
  {
    name: 'copilot_list',
    description: 'List your PairUX AI copilot sessions (newest first) with their one-line summary.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'copilot_report',
    description:
      'Notes, open questions, key figures, follow-ups and review for one copilot session. Set transcript to include the transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Copilot id from copilot_list.' },
        transcript: { type: 'boolean', description: 'Include the full transcript.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'copilot_ask',
    description:
      'Ask your live copilot a private question about the meeting in progress (answers come only from what was said).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The PairUX meeting (session) id.' },
        question: { type: 'string' },
      },
      required: ['sessionId', 'question'],
      additionalProperties: false,
    },
  },
  {
    name: 'copilot_recap',
    description: 'What was said in the last N seconds (default 30) of your live copilot meeting.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        seconds: { type: 'number', minimum: 10, maximum: 300 },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'copilot_follow_ups',
    description:
      'Write (or rewrite) the follow-up action items and recap message for a copilot session.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
] as const;

export class McpToolError extends Error {}

function report(state: CopilotState, title: string | null, transcript: boolean) {
  return {
    id: state.id,
    sessionId: state.sessionId,
    title,
    role: state.role,
    status: state.status,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    notes: state.notes,
    openQuestions: state.openQuestions,
    figures: state.figures,
    suggestions: state.suggestions.map((one) => one.question),
    followUps: state.followUps,
    review: state.review,
    providers: state.providers,
    ...(transcript
      ? { transcript: state.transcript.map((line) => `${line.name}: ${line.text}`) }
      : {}),
  };
}

const str = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === 'string' ? args[key].trim() : '';

export async function callMcpTool(
  runtime: CopilotRuntime,
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'copilot_list':
      return { copilots: await runtime.store.list(userId) };
    case 'copilot_report':
    case 'copilot_follow_ups': {
      const id = str(args, 'id');
      if (!UUID.test(id)) throw new McpToolError('id must be a copilot id from copilot_list.');
      const stored = await runtime.store.get(id, userId);
      if (!stored) throw new McpToolError('No such copilot.');
      const state = runtime.get(stored.state.sessionId, userId)?.state ?? stored.state;
      if (name === 'copilot_report') return report(state, stored.title, args.transcript === true);
      if (!(await runtime.accounts.eligible(userId)))
        throw new McpToolError('The AI copilot is part of PairUX Pro.');
      const ctx = await runtime.context(state.sessionId, userId, state.mode);
      state.followUps = await writeFollowUps(runtime.llm, ctx, state, stored.participantId);
      if (!state.review && state.status === 'ended')
        state.review = await writeReview(runtime.llm, ctx, state, stored.participantId);
      await runtime.store.save(state);
      return { followUps: state.followUps };
    }
    case 'copilot_ask':
    case 'copilot_recap': {
      const sessionId = str(args, 'sessionId');
      if (!UUID.test(sessionId)) throw new McpToolError('sessionId must be a meeting id.');
      const agent = runtime.get(sessionId, userId);
      if (!agent) throw new McpToolError('No copilot is running for you in that meeting.');
      agent.lastSeen = Date.now();
      if (name === 'copilot_ask') {
        const question = str(args, 'question').slice(0, 2000);
        if (!question) throw new McpToolError('Ask something.');
        return { answer: await agent.ask(question) };
      }
      const seconds = Math.min(300, Math.max(10, Number(args.seconds) || 30));
      return { recap: await agent.recap(seconds), seconds };
    }
    default:
      throw new McpToolError(`Unknown tool: ${name}`);
  }
}
