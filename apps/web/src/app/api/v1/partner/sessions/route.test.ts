import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '@/test/mocks/memory-db';
import { hashPartnerKey } from '@/lib/partners';

let db: ReturnType<typeof createMemoryDb>;
vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => db }));

const { POST: open } = await import('./route');
const { GET: status, DELETE: end } = await import('./[sessionId]/route');

// Built at runtime: a key-shaped literal trips secret scanners, and this one is fake.
const KEY = ['pux', 'pk', 'b'.repeat(32)].join('_');
const OTHER = ['pux', 'pk', 'o'.repeat(32)].join('_');
const OWNER = '33333333-3333-4333-8333-333333333333';

const req = (body: unknown, key: string | null = KEY, method = 'POST') =>
  new Request('https://pairux.com/api/v1/partner/sessions', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-real-ip': `10.1.0.${String(Math.random())}`,
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : null,
  });

beforeEach(() => {
  vi.stubEnv(
    'PAIRUX_PARTNERS',
    JSON.stringify([
      { id: 'board-saas', name: 'board.saas', keySha256: hashPartnerKey(KEY), ownerUserId: OWNER },
      { id: 'qrypt', name: 'qrypt.chat', keySha256: hashPartnerKey(OTHER) },
    ])
  );
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pairux.com');
  db = createMemoryDb({ sessions: [], scheduled_sessions: [], session_participants: [] });
  db.onRpc('user_effective_plan', () => ({ data: 'team', error: null }));
  let n = 0;
  db.onRpc('join_session_as_agent', (args) => {
    n++;
    const row = {
      id: `agent-${String(n)}`,
      session_id: db.tables.sessions?.[0]?.id,
      display_name: args.p_display_name,
      kind: 'agent',
      left_at: null,
      joined_at: new Date().toISOString(),
    };
    db.tables.session_participants?.push(row);
    return { data: row, error: null };
  });
});

const json = async (res: Response): Promise<Record<string, unknown>> => {
  const j = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  return j.data ?? (j as Record<string, unknown>);
};

describe('POST /api/v1/partner/sessions', () => {
  it('refuses unknown keys and partners without a service owner', async () => {
    expect((await open(req({ subject: 'x' }, null))).status).toBe(401);
    expect((await open(req({ subject: 'x' }, OTHER))).status).toBe(403);
  });

  it('opens an active SFU session owned by the service account and seats the agents', async () => {
    const res = await open(
      req({
        subject: 'Board meeting',
        agents: [{ name: 'Chair (AI)' }, { name: 'CFO (AI)' }],
        recorded: true,
      })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data).toMatchObject({
      joinUrl: expect.stringMatching(/^https:\/\/pairux\.com\/join\/[A-Z0-9]{6}$/),
    });
    expect((data.agents as unknown[]).length).toBe(2);
    const session = db.tables.sessions?.[0] as Record<string, unknown>;
    expect(session).toMatchObject({
      host_user_id: OWNER,
      status: 'active',
      mode: 'sfu',
      is_public: false,
    });
    expect(session.settings).toMatchObject({
      partner: 'board-saas',
      allowAgents: true,
      guestsCanSpeak: true,
      recorded: true,
      maxParticipants: 2000,
    });
  });

  it('lets only the owning partner read or end its session', async () => {
    const data = await json(await open(req({ subject: 'Board meeting', agents: [] })));
    const params = {
      params: Promise.resolve({ sessionId: '44444444-4444-4444-8444-444444444444' }),
    };
    const session = db.tables.sessions?.[0] as Record<string, unknown>;
    session.id = '44444444-4444-4444-8444-444444444444';
    expect(data.joinCode).toBeTruthy();
    expect((await status(req(null, OTHER, 'GET'), params)).status).toBe(404);
    const s = await json(await status(req(null, KEY, 'GET'), params));
    expect(s.status).toBe('active');
    expect((await end(req(null, KEY, 'DELETE'), params)).status).toBe(200);
    expect(session.status).toBe('ended');
  });
});
