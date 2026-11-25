import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '@/test/mocks/memory-db';
import { sortQuestions, type QuestionView } from '@/lib/questions';

let db: ReturnType<typeof createMemoryDb>;
let signedIn: string | null = null;

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => db,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
  getAuthenticatedUser: () =>
    Promise.resolve({ user: signedIn ? { id: signedIn } : null, error: null }),
}));

const { GET: list, POST: ask } = await import('./[sessionId]/questions/route');
const { POST: act } = await import('./[sessionId]/questions/[questionId]/route');
const { PATCH: agentPatch } =
  await import('../agents/[participantId]/questions/[questionId]/route');
const { GET: poll } = await import('../agents/[participantId]/route');

const SESSION = '22222222-2222-4222-8222-222222222222';
const GUEST = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';
const OWNER_USER = '55555555-5555-4555-8555-555555555555';
const AGENT = '11111111-1111-4111-8111-111111111111';
const Q1 = '66666666-6666-4666-8666-666666666666';
const Q2 = '77777777-7777-4777-8777-777777777777';

const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  session_id: SESSION,
  role: 'viewer',
  kind: 'human',
  user_id: null,
  agent_client: null,
  control_state: 'view-only',
  joined_at: '2026-11-25T10:00:00.000Z',
  left_at: null,
  last_seen_at: new Date().toISOString(),
  ...extra,
});

function seed() {
  signedIn = null;
  db = createMemoryDb({
    sessions: [
      {
        id: SESSION,
        status: 'active',
        subject: 'Board meeting',
        join_code: 'ABC123',
        host_user_id: 'service-account',
        settings: { partner: 'board-saas', qaModerators: [OWNER_USER] },
      },
    ],
    session_participants: [
      row(GUEST, { display_name: 'Sam' }),
      row(OWNER, { display_name: 'Anthony', user_id: OWNER_USER }),
      row(AGENT, { display_name: 'Chair (AI)', kind: 'agent' }),
    ],
    session_questions: [
      {
        id: Q1,
        session_id: SESSION,
        participant_id: OWNER,
        display_name: 'Anthony',
        content: 'What does it cost?',
        status: 'open',
        bumped_at: null,
        answered_at: null,
        created_at: '2026-11-25T10:01:00.000Z',
      },
      {
        id: Q2,
        session_id: SESSION,
        participant_id: OWNER,
        display_name: 'Anthony',
        content: 'Who should we hire?',
        status: 'open',
        bumped_at: null,
        answered_at: null,
        created_at: '2026-11-25T10:02:00.000Z',
      },
    ],
    session_question_votes: [],
    chat_messages: [],
  });
}

const json = (body: unknown) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});
const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, init);
const sp = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });
const qp = (sessionId: string, questionId: string) => ({
  params: Promise.resolve({ sessionId, questionId }),
});

beforeEach(seed);

describe('room Q&A', () => {
  it('a guest asks with their participant id; strangers cannot', async () => {
    let res = await ask(
      req(
        `/api/v1/sessions/${SESSION}/questions`,
        json({ participantId: GUEST, content: 'How do we reach more customers?' })
      ),
      sp(SESSION)
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { display_name: string; status: string } };
    expect(body.data).toMatchObject({ display_name: 'Sam', status: 'open' });
    res = await ask(
      req(`/api/v1/sessions/${SESSION}/questions`, json({ content: 'Who am I?' })),
      sp(SESSION)
    );
    expect(res.status).toBe(403);
    // A signed-in user's participant id is not a credential for anyone else.
    res = await ask(
      req(
        `/api/v1/sessions/${SESSION}/questions`,
        json({ participantId: OWNER, content: 'Pretending' })
      ),
      sp(SESSION)
    );
    expect(res.status).toBe(403);
  });

  it('votes sort the queue; a moderator named by the partner picks the next question', async () => {
    let res = await act(
      req(
        `/api/v1/sessions/${SESSION}/questions/${Q2}`,
        json({ participantId: GUEST, action: 'vote' })
      ),
      qp(SESSION, Q2)
    );
    expect(res.status).toBe(200);
    let body = (await res.json()) as { data: { questions: QuestionView[]; canModerate: boolean } };
    expect(body.data.canModerate).toBe(false);
    expect(body.data.questions.map((q) => q.id)).toEqual([Q2, Q1]);
    expect(body.data.questions[0]).toMatchObject({ votes: 1, voted: true });
    // The guest cannot bump; the owner (signed in, a qaModerator) can.
    res = await act(
      req(
        `/api/v1/sessions/${SESSION}/questions/${Q1}`,
        json({ participantId: GUEST, action: 'bump' })
      ),
      qp(SESSION, Q1)
    );
    expect(res.status).toBe(403);
    signedIn = OWNER_USER;
    res = await act(
      req(`/api/v1/sessions/${SESSION}/questions/${Q1}`, json({ action: 'bump' })),
      qp(SESSION, Q1)
    );
    body = (await res.json()) as { data: { questions: QuestionView[]; canModerate: boolean } };
    expect(body.data.canModerate).toBe(true);
    expect(body.data.questions[0]?.id).toBe(Q1);
    // You cannot vote for your own question.
    res = await act(
      req(`/api/v1/sessions/${SESSION}/questions/${Q1}`, json({ action: 'vote' })),
      qp(SESSION, Q1)
    );
    expect(res.status).toBe(400);
  });

  it('agents read the queue in their poll and mark a question now answering, then answered', async () => {
    let res = await poll(req(`/api/v1/agents/${AGENT}`), {
      params: Promise.resolve({ participantId: AGENT }),
    });
    const pollBody = (await res.json()) as {
      data: { questions: QuestionView[]; participants: { id: string; user_id?: string | null }[] };
    };
    expect(pollBody.data.questions).toHaveLength(2);
    expect(pollBody.data.participants.find((p) => p.id === OWNER)?.user_id).toBe(OWNER_USER);
    res = await agentPatch(
      req(`/api/v1/agents/${AGENT}/questions/${Q1}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'answering' }),
      }),
      { params: Promise.resolve({ participantId: AGENT, questionId: Q1 }) }
    );
    expect(res.status).toBe(200);
    res = await list(
      req(`/api/v1/sessions/${SESSION}/questions?participantId=${GUEST}`),
      sp(SESSION)
    );
    let body = (await res.json()) as { data: { questions: QuestionView[] } };
    expect(body.data.questions[0]).toMatchObject({ id: Q1, status: 'answering' });
    await agentPatch(
      req(`/api/v1/agents/${AGENT}/questions/${Q1}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'answered' }),
      }),
      { params: Promise.resolve({ participantId: AGENT, questionId: Q1 }) }
    );
    res = await list(
      req(`/api/v1/sessions/${SESSION}/questions?participantId=${GUEST}`),
      sp(SESSION)
    );
    body = (await res.json()) as { data: { questions: QuestionView[] } };
    expect(body.data.questions.map((q) => q.status)).toEqual(['open', 'answered']);
    // A human cannot use the agent route.
    res = await agentPatch(
      req(`/api/v1/agents/${GUEST}/questions/${Q1}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'answered' }),
      }),
      { params: Promise.resolve({ participantId: GUEST, questionId: Q1 }) }
    );
    expect(res.status).toBe(404);
  });

  it('display order: now answering, picked, most voted, oldest, then answered', () => {
    const q = (id: string, extra: Partial<QuestionView>): QuestionView => ({
      id,
      participant_id: null,
      display_name: 'x',
      content: id,
      status: 'open',
      votes: 0,
      voted: false,
      mine: false,
      bumped_at: null,
      answered_at: null,
      created_at: '2026-11-25T10:00:00.000Z',
      ...extra,
    });
    const sorted = sortQuestions([
      q('done', { status: 'answered' }),
      q('old', { created_at: '2026-11-25T09:00:00.000Z' }),
      q('voted', { votes: 3 }),
      q('picked', { bumped_at: '2026-11-25T10:05:00.000Z' }),
      q('now', { status: 'answering' }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['now', 'picked', 'voted', 'old', 'done']);
  });
});
