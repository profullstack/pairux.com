import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '@/test/mocks/memory-db';

let db: ReturnType<typeof createMemoryDb>;

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => db,
}));

const { POST: join } = await import('./join/route');
const { GET: poll, DELETE: leave } = await import('./[participantId]/route');
const { POST: say } = await import('./[participantId]/messages/route');

const SESSION = '22222222-2222-4222-8222-222222222222';
const AGENT = '11111111-1111-4111-8111-111111111111';

function req(url: string, init: RequestInit = {}) {
  return new Request(`http://localhost${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-real-ip': `10.0.0.${String(Math.random())}` },
  });
}

const params = (participantId: string) => ({ params: Promise.resolve({ participantId }) });

function seed(overrides: Record<string, unknown> = {}) {
  db = createMemoryDb({
    sessions: [{ id: SESSION, status: 'active', subject: 'Pairing', join_code: 'ABC123' }],
    session_participants: [
      {
        id: 'host-p',
        session_id: SESSION,
        display_name: 'Anthony',
        role: 'host',
        kind: 'human',
        agent_client: null,
        control_state: 'view-only',
        joined_at: '2026-09-24T11:00:00.000Z',
        left_at: null,
        last_seen_at: new Date().toISOString(),
      },
      {
        id: AGENT,
        session_id: SESSION,
        display_name: 'Claude Code',
        role: 'viewer',
        kind: 'agent',
        agent_client: 'claude-code',
        control_state: 'view-only',
        joined_at: '2026-09-24T11:30:00.000Z',
        left_at: null,
        last_seen_at: new Date().toISOString(),
        ...overrides,
      },
    ],
    chat_messages: [
      {
        id: 'm1',
        session_id: SESSION,
        display_name: 'Anthony',
        content: 'old',
        message_type: 'text',
        recipient_id: null,
        created_at: '2026-09-24T11:40:00.000Z',
      },
      {
        id: 'm2',
        session_id: SESSION,
        display_name: 'Anthony',
        content: 'new',
        message_type: 'text',
        recipient_id: null,
        created_at: '2026-09-24T11:50:00.000Z',
      },
      {
        id: 'dm',
        session_id: SESSION,
        display_name: 'Anthony',
        content: 'private',
        message_type: 'text',
        recipient_id: 'someone',
        created_at: '2026-09-24T11:55:00.000Z',
      },
    ],
  });
}

beforeEach(() => {
  seed();
});

describe('POST /api/v1/agents/join', () => {
  it('joins through join_session_as_agent with no owner when anonymous', async () => {
    let args: Record<string, unknown> = {};
    db.onRpc('join_session_as_agent', (a) => {
      args = a;
      return {
        data: { id: 'new-agent', session_id: SESSION, display_name: 'Reviewer' },
        error: null,
      };
    });
    const res = await join(
      req('/api/v1/agents/join', {
        method: 'POST',
        body: JSON.stringify({ joinCode: 'abc123', name: ' Reviewer ', client: 'Claude-Code' }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      participantId: 'new-agent',
      sessionId: SESSION,
      displayName: 'Reviewer',
      owned: false,
    });
    expect(args).toEqual({
      p_join_code: 'abc123',
      p_display_name: 'Reviewer',
      p_agent_client: 'claude-code',
      p_owner_id: null,
    });
  });

  it.each([
    ['Session not found or has ended', 404],
    ['The host is not accepting agents in this session', 403],
    ['This session already has the maximum number of agents', 409],
  ])('maps "%s" to %i', async (message, status) => {
    db.onRpc('join_session_as_agent', () => ({ data: null, error: { message } }));
    const res = await join(
      req('/api/v1/agents/join', {
        method: 'POST',
        body: JSON.stringify({ joinCode: 'ABC123', name: 'Bot' }),
      })
    );
    expect(res.status).toBe(status);
  });

  it('validates the join code and name', async () => {
    const res = await join(
      req('/api/v1/agents/join', {
        method: 'POST',
        body: JSON.stringify({ joinCode: 'nope', name: 'B' }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/agents/[participantId]', () => {
  it('returns roster and public chat after the cursor, and stamps presence', async () => {
    const res = await poll(
      req(`/api/v1/agents/${AGENT}?after=2026-09-24T11:45:00.000Z`),
      params(AGENT)
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { participants: { id: string }[]; messages: { id: string }[]; session: object };
    };
    expect(data.participants.map((p) => p.id)).toEqual(['host-p', AGENT]);
    expect(data.messages.map((m) => m.id)).toEqual(['m2']); // not m1 (old), not the DM
    expect(data.session).toMatchObject({ joinCode: 'ABC123', status: 'active' });
    const agentRow = db.tables.session_participants!.find((p) => p.id === AGENT)!;
    expect(agentRow.connection_status).toBe('connected');
  });

  it('retires other agents that stopped polling', async () => {
    db.tables.session_participants!.push({
      id: 'stale',
      session_id: SESSION,
      display_name: 'Crashed',
      role: 'viewer',
      kind: 'agent',
      left_at: null,
      joined_at: '2026-09-24T10:00:00.000Z',
      last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const res = await poll(req(`/api/v1/agents/${AGENT}`), params(AGENT));
    const { data } = (await res.json()) as { data: { participants: { id: string }[] } };
    expect(data.participants.map((p) => p.id)).not.toContain('stale');
  });

  it('is 410 once the host removed the agent', async () => {
    seed({ left_at: '2026-09-24T12:00:00.000Z' });
    const res = await poll(req(`/api/v1/agents/${AGENT}`), params(AGENT));
    expect(res.status).toBe(410);
  });

  it('is 410 when the session ended', async () => {
    db.tables.sessions![0]!.status = 'ended';
    const res = await poll(req(`/api/v1/agents/${AGENT}`), params(AGENT));
    expect(res.status).toBe(410);
  });

  it('is 404 for a human participant id: this API is agents-only', async () => {
    const res = await poll(
      req('/api/v1/agents/33333333-3333-4333-8333-333333333333'),
      params('33333333-3333-4333-8333-333333333333')
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/agents/[participantId]/messages', () => {
  it('sends through send_chat_message as the agent row', async () => {
    let args: Record<string, unknown> = {};
    db.onRpc('send_chat_message', (a) => {
      args = a;
      return { data: { id: 'm3', content: a.p_content }, error: null };
    });
    const res = await say(
      req(`/api/v1/agents/${AGENT}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: 'Tests pass' }),
      }),
      params(AGENT)
    );
    expect(res.status).toBe(201);
    expect(args).toEqual({
      p_session_id: SESSION,
      p_content: 'Tests pass',
      p_participant_id: AGENT,
      p_recipient_id: null,
    });
  });

  it('refuses a removed agent', async () => {
    seed({ left_at: '2026-09-24T12:00:00.000Z' });
    const res = await say(
      req(`/api/v1/agents/${AGENT}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: 'hi' }),
      }),
      params(AGENT)
    );
    expect(res.status).toBe(410);
  });

  it('rejects messages over 500 characters', async () => {
    const res = await say(
      req(`/api/v1/agents/${AGENT}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: 'x'.repeat(501) }),
      }),
      params(AGENT)
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/agents/[participantId]', () => {
  it('marks the agent as left', async () => {
    const res = await leave(req(`/api/v1/agents/${AGENT}`, { method: 'DELETE' }), params(AGENT));
    expect(res.status).toBe(200);
    const row = db.tables.session_participants!.find((p) => p.id === AGENT)!;
    expect(row.left_at).toBeTruthy();
    expect(row.connection_status).toBe('disconnected');
  });
});
