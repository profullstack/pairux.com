import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

const mockServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => mockServiceClient(),
}));

const mockSendStartNotices = vi.fn();
vi.mock('@/lib/meeting-start', () => ({
  sendMeetingStartNotices: (...args: unknown[]) => mockSendStartNotices(...args),
}));

const mockGetUniqueJoinCode = vi.fn();
vi.mock('@/lib/join-code', () => ({
  getUniqueJoinCode: (...args: unknown[]) => mockGetUniqueJoinCode(...args),
}));

interface Chain {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
}

type Resolver = (chain: Chain) => { data: unknown; error: unknown };

/** Same shape of stand-in as the sibling route test: chainable and awaitable. */
function createServiceMock(resolve: Resolver) {
  const calls: Chain[] = [];

  const from = vi.fn((table: string) => {
    const chain: Chain = { table, op: 'select', filters: {} };
    calls.push(chain);

    const settle = () => Promise.resolve(resolve(chain));

    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      insert: vi.fn((rows: unknown) => {
        chain.op = 'insert';
        chain.payload = rows;
        return builder;
      }),
      update: vi.fn((row: unknown) => {
        chain.op = 'update';
        chain.payload = row;
        return builder;
      }),
      eq: vi.fn((key: string, value: unknown) => {
        chain.filters[key] = value;
        return builder;
      }),
      single: vi.fn(settle),
      maybeSingle: vi.fn(settle),
      then: (onFulfilled?: never, onRejected?: never) => settle().then(onFulfilled, onRejected),
    };

    return builder;
  });

  return { client: { from }, calls };
}

const MEETING_ID = 'meeting-1';
const JOIN_CODE = 'ABC123';

const baseMeeting: {
  id: string;
  host_user_id: string;
  title: string;
  scheduled_at: string;
  duration_minutes: number;
  join_code: string;
  status: string;
  session_id: string | null;
  started_at: string | null;
} = {
  id: MEETING_ID,
  host_user_id: mockUser.id,
  title: 'Weekly Sync',
  scheduled_at: '2026-09-01T15:00:00+00:00',
  duration_minutes: 60,
  join_code: JOIN_CODE,
  status: 'pending',
  session_id: null,
  started_at: null,
};

function setupService(options: {
  meeting?: Partial<typeof baseMeeting> | null;
  /** A row in `sessions` already holding the meeting's join code. */
  holder?: { id: string; status: string } | null;
  invitees?: { id: string; email: string; name: string | null; rsvp_status: string }[];
}) {
  const meeting = options.meeting === null ? null : { ...baseMeeting, ...options.meeting };

  const mock = createServiceMock((chain) => {
    if (chain.table === 'sessions' && chain.op === 'select') {
      const holder = options.holder ?? null;
      return {
        data: holder ? { ...holder, join_code: JOIN_CODE } : null,
        error: null,
      };
    }
    if (chain.table === 'sessions' && chain.op === 'update') {
      return { data: null, error: null };
    }
    if (chain.table === 'scheduled_sessions' && chain.op === 'select') {
      return {
        data: meeting ? { ...meeting, scheduled_session_invitees: options.invitees ?? [] } : null,
        error: null,
      };
    }
    if (chain.table === 'profiles') {
      return { data: { display_name: 'Ada', plan: 'free', plan_expires_at: null }, error: null };
    }
    return { data: null, error: null };
  });

  mockServiceClient.mockReturnValue(mock.client);
  return mock;
}

function call() {
  return POST(new Request('http://localhost/start', { method: 'POST' }), {
    params: Promise.resolve({ id: MEETING_ID }),
  });
}

describe('POST /api/scheduled-sessions/[id]/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
    mockSendStartNotices.mockResolvedValue({ notified: 0, skipped: 0, errors: [] });
    mockGetUniqueJoinCode.mockResolvedValue('ZZZ999');
    mockRpc.mockResolvedValue({ data: { id: 'session-1', join_code: JOIN_CODE }, error: null });
  });

  it('requires authentication', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: 'nope' });
    setupService({});

    const res = await call();
    expect(res.status).toBe(401);
  });

  it('404s a meeting the caller does not host', async () => {
    setupService({ meeting: null });

    const res = await call();
    expect(res.status).toBe(404);
  });

  it('refuses a cancelled meeting', async () => {
    setupService({ meeting: { status: 'cancelled' } });

    const res = await call();
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('creates the room under the meeting join code and mails the guest list', async () => {
    const invitees = [{ id: 'i1', email: 'guest@example.com', name: null, rsvp_status: 'pending' }];
    mockSendStartNotices.mockResolvedValue({ notified: 1, skipped: 0, errors: [] });
    const mock = setupService({ invitees });

    const res = await call();
    const body = (await res.json()) as {
      data: { session: { id: string }; resumed: boolean; notified: number };
    };

    expect(res.status).toBe(200);
    expect(body.data.session.id).toBe('session-1');
    expect(body.data.resumed).toBe(false);
    expect(body.data.notified).toBe(1);

    // The emailed code is the room's code; anything else strands the invitees.
    expect(mockRpc).toHaveBeenCalledWith(
      'create_session',
      expect.objectContaining({ p_join_code: JOIN_CODE })
    );

    // The meeting now points at the room it is being held in.
    const stamp = mock.calls.find((c) => c.table === 'scheduled_sessions' && c.op === 'update')
      ?.payload as { session_id?: string; started_at?: string } | undefined;
    expect(stamp?.session_id).toBe('session-1');
    expect(stamp?.started_at).toBeTruthy();

    expect(mockSendStartNotices).toHaveBeenCalledWith(
      expect.objectContaining({ invitees, hostName: 'Ada' })
    );
  });

  it('adopts a room that is already open rather than creating a second one', async () => {
    setupService({
      meeting: { session_id: 'session-1', started_at: '2026-09-01T15:00:05+00:00' },
      holder: { id: 'session-1', status: 'active' },
    });

    const res = await call();
    const body = (await res.json()) as {
      data: { session: { id: string }; resumed: boolean; startedAt: string };
    };

    expect(res.status).toBe(200);
    expect(body.data.resumed).toBe(true);
    expect(body.data.session.id).toBe('session-1');
    // Creating again would fail on the unique join code.
    expect(mockRpc).not.toHaveBeenCalled();
    // The original start time survives, so the notice ledger keeps its slots.
    expect(body.data.startedAt).toBe('2026-09-01T15:00:05+00:00');
  });

  it('takes the join code back off an ended room before reusing it', async () => {
    const mock = setupService({ holder: { id: 'old-session', status: 'ended' } });

    const res = await call();
    expect(res.status).toBe(200);

    // `sessions.join_code` is unique and never released, so the second
    // occurrence of a recurring meeting can only reuse the code once the dead
    // room has given it up.
    const release = mock.calls.find((c) => c.table === 'sessions' && c.op === 'update');
    expect((release?.payload as { join_code?: string } | undefined)?.join_code).toBe('ZZZ999');
    expect(release?.filters.id).toBe('old-session');
    expect(mockRpc).toHaveBeenCalledWith(
      'create_session',
      expect.objectContaining({ p_join_code: JOIN_CODE })
    );
  });

  it('reports a failed create rather than pretending the meeting started', async () => {
    setupService({});
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Join code already in use' } });

    const res = await call();
    expect(res.status).toBe(400);
    expect(mockSendStartNotices).not.toHaveBeenCalled();
  });
});
