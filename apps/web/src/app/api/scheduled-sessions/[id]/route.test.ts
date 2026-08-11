import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './route';
import { mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

const mockServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => mockServiceClient(),
}));

const mockSendMeetingInvites = vi.fn().mockResolvedValue({ ok: true });
const mockSendMeetingUpdate = vi.fn().mockResolvedValue({ ok: true });
const mockSendInviteeRemoval = vi.fn().mockResolvedValue({ ok: true });
const mockSendMeetingCancellation = vi.fn().mockResolvedValue({ ok: true });

vi.mock('@/app/actions/meetings', () => ({
  sendMeetingInvites: (...args: unknown[]) => mockSendMeetingInvites(...args),
  sendMeetingUpdate: (...args: unknown[]) => mockSendMeetingUpdate(...args),
  sendInviteeRemoval: (...args: unknown[]) => mockSendInviteeRemoval(...args),
  sendMeetingCancellation: (...args: unknown[]) => mockSendMeetingCancellation(...args),
}));

interface Chain {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Record<string, unknown>;
}

type Resolver = (chain: Chain) => { data: unknown; error: unknown };

/**
 * Minimal stand-in for the supabase query builder: every method chains, and the
 * builder itself is awaitable. `resolve` decides what each chain returns based on
 * the table and the operation it ended up performing.
 */
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
      delete: vi.fn(() => {
        chain.op = 'delete';
        return builder;
      }),
      eq: vi.fn((key: string, value: unknown) => {
        chain.filters[key] = value;
        return builder;
      }),
      in: vi.fn((key: string, value: unknown) => {
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

const baseMeeting = {
  id: MEETING_ID,
  host_user_id: mockUser.id,
  title: 'Weekly Sync',
  description: 'Agenda',
  scheduled_at: '2026-09-01T15:00:00+00:00',
  duration_minutes: 60,
  join_code: 'ABC123',
  status: 'pending',
};

function invitee(email: string, id: string) {
  return { id, email, name: null, invite_token: `token-${id}` };
}

/** Wires up the service mock for a meeting with the given existing invitees. */
function setupService(options: {
  existingInvitees?: { id: string; email: string; name: string | null; invite_token: string }[];
  meeting?: Partial<typeof baseMeeting>;
  /** Simulate the host having already started the meeting under its join code. */
  liveSession?: boolean;
  /** Make the join_code UPDATE fail, as a unique-constraint clash would. */
  rotateFails?: boolean;
}) {
  const existingInvitees = options.existingInvitees ?? [];
  const meeting = { ...baseMeeting, ...options.meeting };

  const mock = createServiceMock((chain) => {
    // Probing whether a candidate join code is free — matched on the filter rather
    // than the table, since both tables are checked with the same shape of query.
    if (chain.op === 'select' && chain.filters.join_code !== undefined) {
      const isLive = chain.table === 'sessions' && chain.filters.join_code === meeting.join_code;
      return { data: isLive && options.liveSession === true ? { id: 'live-1' } : null, error: null };
    }
    if (chain.table === 'scheduled_sessions' && chain.op === 'select') {
      return {
        data: { ...meeting, scheduled_session_invitees: existingInvitees },
        error: null,
      };
    }
    if (
      chain.table === 'scheduled_sessions' &&
      chain.op === 'update' &&
      (chain.payload as { join_code?: string }).join_code !== undefined &&
      options.rotateFails === true
    ) {
      return { data: null, error: { message: 'duplicate key value' } };
    }
    if (chain.table === 'scheduled_sessions' && chain.op === 'update') {
      return { data: { ...meeting, ...(chain.payload as object) }, error: null };
    }
    if (chain.table === 'profiles') {
      return { data: { display_name: 'Host Person' }, error: null };
    }
    if (chain.table === 'scheduled_session_invitees' && chain.op === 'insert') {
      const rows = chain.payload as { email: string }[];
      return {
        data: rows.map((row, index) => ({
          id: `new-${String(index)}`,
          email: row.email,
          name: null,
          invite_token: `new-token-${String(index)}`,
        })),
        error: null,
      };
    }
    return { data: [], error: null };
  });

  mockServiceClient.mockReturnValue(mock.client);
  return mock;
}

function patchRequest(body: unknown) {
  return new Request(`http://localhost/api/scheduled-sessions/${MEETING_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: MEETING_ID });

describe('PATCH /api/scheduled-sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
    mockSendMeetingInvites.mockResolvedValue({ ok: true });
    mockSendMeetingUpdate.mockResolvedValue({ ok: true });
    mockSendInviteeRemoval.mockResolvedValue({ ok: true });
  });

  it('requires authentication', async () => {
    setupService({});
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: 'nope' });

    const response = await PATCH(patchRequest({ title: 'New' }), { params });

    expect(response.status).toBe(401);
  });

  it('updates the time, accepting camelCase and writing snake_case columns', async () => {
    const mock = setupService({});

    const response = await PATCH(
      patchRequest({ scheduledAt: '2026-09-02T18:30:00.000Z', durationMinutes: 90 }),
      { params }
    );

    expect(response.status).toBe(200);

    const update = mock.calls.find((c) => c.table === 'scheduled_sessions' && c.op === 'update');
    expect(update?.payload).toMatchObject({
      scheduled_at: '2026-09-02T18:30:00.000Z',
      duration_minutes: 90,
    });
    expect(update?.filters).toMatchObject({ id: MEETING_ID, host_user_id: mockUser.id });
  });

  it('adds new invitees and emails only them', async () => {
    const mock = setupService({ existingInvitees: [invitee('old@example.com', 'i1')] });

    const response = await PATCH(
      patchRequest({ inviteeEmails: ['old@example.com', 'New@Example.com'] }),
      { params }
    );

    expect(response.status).toBe(200);

    const insert = mock.calls.find(
      (c) => c.table === 'scheduled_session_invitees' && c.op === 'insert'
    );
    expect(insert?.payload).toHaveLength(1);
    expect((insert?.payload as { email: string }[])[0]?.email).toBe('new@example.com');

    expect(mockSendMeetingInvites).toHaveBeenCalledTimes(1);
    const invitePayload = mockSendMeetingInvites.mock.calls[0]?.[0] as {
      invitees: { email: string }[];
    };
    expect(invitePayload.invitees.map((i) => i.email)).toEqual(['new@example.com']);

    // Nothing about the meeting itself changed, so nobody gets an update notice.
    expect(mockSendMeetingUpdate).not.toHaveBeenCalled();
    expect(mockSendInviteeRemoval).not.toHaveBeenCalled();
  });

  it('removes invitees left off the list and tells them', async () => {
    const mock = setupService({
      existingInvitees: [invitee('stay@example.com', 'i1'), invitee('drop@example.com', 'i2')],
    });

    const response = await PATCH(patchRequest({ inviteeEmails: ['stay@example.com'] }), { params });

    expect(response.status).toBe(200);

    const del = mock.calls.find(
      (c) => c.table === 'scheduled_session_invitees' && c.op === 'delete'
    );
    expect(del?.filters.id).toEqual(['i2']);

    expect(mockSendInviteeRemoval).toHaveBeenCalledTimes(1);
    expect(mockSendInviteeRemoval.mock.calls[0]?.[0]).toMatchObject({
      inviteeEmails: ['drop@example.com'],
    });
    expect(mockSendMeetingInvites).not.toHaveBeenCalled();
  });

  describe('join code rotation on removal', () => {
    it('rotates the join code so the removed invitee is actually locked out', async () => {
      const mock = setupService({
        existingInvitees: [invitee('stay@example.com', 'i1'), invitee('drop@example.com', 'i2')],
      });

      const response = await PATCH(patchRequest({ inviteeEmails: ['stay@example.com'] }), {
        params,
      });
      const body = (await response.json()) as { data: { join_code: string } };

      const rotate = mock.calls.find(
        (c) =>
          c.table === 'scheduled_sessions' &&
          c.op === 'update' &&
          (c.payload as { join_code?: string }).join_code !== undefined
      );
      const newCode = (rotate?.payload as { join_code: string }).join_code;

      expect(rotate).toBeDefined();
      expect(newCode).not.toBe('ABC123');
      expect(newCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(rotate?.filters).toMatchObject({ id: MEETING_ID, host_user_id: mockUser.id });

      // The caller sees the new code, so the dashboard stops showing the dead one.
      expect(body.data.join_code).toBe(newCode);
    });

    it('tells the invitees who remain what the new code is', async () => {
      setupService({
        existingInvitees: [invitee('stay@example.com', 'i1'), invitee('drop@example.com', 'i2')],
      });

      await PATCH(patchRequest({ inviteeEmails: ['stay@example.com'] }), { params });

      expect(mockSendMeetingUpdate).toHaveBeenCalledTimes(1);
      const payload = mockSendMeetingUpdate.mock.calls[0]?.[0] as {
        inviteeEmails: string[];
        joinCode: string;
        codeChanged: boolean;
      };

      // Only the retained invitee, and the email must carry the rotated code — sending
      // the old one would leave them holding a code that no longer works.
      expect(payload.inviteeEmails).toEqual(['stay@example.com']);
      expect(payload.codeChanged).toBe(true);
      expect(payload.joinCode).not.toBe('ABC123');
    });

    it('leaves the code alone when nobody was removed', async () => {
      const mock = setupService({ existingInvitees: [invitee('a@example.com', 'i1')] });

      await PATCH(patchRequest({ inviteeEmails: ['a@example.com', 'b@example.com'] }), { params });

      const rotate = mock.calls.find(
        (c) =>
          c.table === 'scheduled_sessions' &&
          c.op === 'update' &&
          (c.payload as { join_code?: string }).join_code !== undefined
      );
      expect(rotate).toBeUndefined();

      // A newly added invitee gets the existing code, which still works.
      const invitePayload = mockSendMeetingInvites.mock.calls[0]?.[0] as { joinCode: string };
      expect(invitePayload.joinCode).toBe('ABC123');
    });

    it('does not rotate once the meeting has started', async () => {
      const mock = setupService({
        existingInvitees: [invitee('stay@example.com', 'i1'), invitee('drop@example.com', 'i2')],
        liveSession: true,
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const response = await PATCH(patchRequest({ inviteeEmails: ['stay@example.com'] }), {
        params,
      });

      // The live room holds its own copy of the code, so rotating the scheduled row
      // would claim a lockout that did not happen.
      const rotate = mock.calls.find(
        (c) =>
          c.table === 'scheduled_sessions' &&
          c.op === 'update' &&
          (c.payload as { join_code?: string }).join_code !== undefined
      );
      expect(rotate).toBeUndefined();
      expect(response.status).toBe(200);
      expect(warn).toHaveBeenCalled();

      // Nothing changed for the people staying, so they are not emailed.
      expect(mockSendMeetingUpdate).not.toHaveBeenCalled();
      // The removal itself still went through.
      expect(mockSendInviteeRemoval).toHaveBeenCalledTimes(1);
    });

    it('still applies the removal when the rotation write fails', async () => {
      const mock = setupService({
        existingInvitees: [invitee('stay@example.com', 'i1'), invitee('drop@example.com', 'i2')],
        rotateFails: true,
      });

      const response = await PATCH(patchRequest({ inviteeEmails: ['stay@example.com'] }), {
        params,
      });

      expect(response.status).toBe(200);

      const del = mock.calls.find(
        (c) => c.table === 'scheduled_session_invitees' && c.op === 'delete'
      );
      expect(del?.filters.id).toEqual(['i2']);

      // The code did not change, so retained invitees must not be told that it did.
      const updateCall = mockSendMeetingUpdate.mock.calls[0]?.[0] as
        | { codeChanged: boolean }
        | undefined;
      expect(updateCall?.codeChanged ?? false).toBe(false);
    });
  });

  it('removes every invitee when given an empty list', async () => {
    const mock = setupService({ existingInvitees: [invitee('a@example.com', 'i1')] });

    await PATCH(patchRequest({ inviteeEmails: [] }), { params });

    const del = mock.calls.find(
      (c) => c.table === 'scheduled_session_invitees' && c.op === 'delete'
    );
    expect(del?.filters.id).toEqual(['i1']);
  });

  it('leaves invitees alone when inviteeEmails is omitted', async () => {
    const mock = setupService({ existingInvitees: [invitee('a@example.com', 'i1')] });

    await PATCH(patchRequest({ title: 'Renamed' }), { params });

    expect(
      mock.calls.some(
        (c) => c.table === 'scheduled_session_invitees' && (c.op === 'delete' || c.op === 'insert')
      )
    ).toBe(false);
  });

  it('notifies retained invitees when the time moves', async () => {
    setupService({ existingInvitees: [invitee('stay@example.com', 'i1')] });

    await PATCH(patchRequest({ scheduledAt: '2026-09-05T15:00:00.000Z' }), { params });

    expect(mockSendMeetingUpdate).toHaveBeenCalledTimes(1);
    expect(mockSendMeetingUpdate.mock.calls[0]?.[0]).toMatchObject({
      inviteeEmails: ['stay@example.com'],
      scheduledAt: '2026-09-05T15:00:00.000Z',
      previousScheduledAt: baseMeeting.scheduled_at,
    });
  });

  it('does not notify when the submitted time is the same instant in another format', async () => {
    setupService({ existingInvitees: [invitee('stay@example.com', 'i1')] });

    // Same moment as baseMeeting.scheduled_at, written as a Z-suffixed ISO string.
    await PATCH(patchRequest({ scheduledAt: '2026-09-01T15:00:00.000Z' }), { params });

    expect(mockSendMeetingUpdate).not.toHaveBeenCalled();
  });

  it('does not notify removed invitees about the update', async () => {
    setupService({
      existingInvitees: [invitee('stay@example.com', 'i1'), invitee('drop@example.com', 'i2')],
    });

    await PATCH(patchRequest({ title: 'Renamed', inviteeEmails: ['stay@example.com'] }), {
      params,
    });

    expect(mockSendMeetingUpdate.mock.calls[0]?.[0]).toMatchObject({
      inviteeEmails: ['stay@example.com'],
    });
    expect(mockSendInviteeRemoval).toHaveBeenCalledTimes(1);
  });

  it('returns the refreshed invitee list', async () => {
    mockServiceClient.mockReturnValue(
      createServiceMock((chain) => {
        if (chain.table === 'scheduled_sessions' && chain.op === 'select') {
          return { data: { ...baseMeeting, scheduled_session_invitees: [] }, error: null };
        }
        if (chain.table === 'scheduled_sessions' && chain.op === 'update') {
          return { data: { ...baseMeeting, ...(chain.payload as object) }, error: null };
        }
        if (chain.table === 'profiles') return { data: { display_name: 'Host' }, error: null };
        if (chain.table === 'scheduled_session_invitees' && chain.op === 'insert') {
          return {
            data: [{ id: 'n1', email: 'new@example.com', name: null, invite_token: 't' }],
            error: null,
          };
        }
        return {
          data: [{ id: 'n1', email: 'new@example.com', name: null, rsvp_status: 'pending' }],
          error: null,
        };
      }).client
    );

    const response = await PATCH(patchRequest({ inviteeEmails: ['new@example.com'] }), { params });
    const body = (await response.json()) as {
      data: { invitee_count: number; invitees: { email: string }[] };
    };

    expect(body.data.invitee_count).toBe(1);
    expect(body.data.invitees[0]?.email).toBe('new@example.com');
  });

  it('404s when the meeting is not the caller’s', async () => {
    mockServiceClient.mockReturnValue(
      createServiceMock(() => ({ data: null, error: null })).client
    );

    const response = await PATCH(patchRequest({ title: 'New' }), { params });

    expect(response.status).toBe(404);
  });

  it('refuses to edit a cancelled meeting', async () => {
    setupService({ meeting: { status: 'cancelled' } });

    const response = await PATCH(patchRequest({ title: 'New' }), { params });

    expect(response.status).toBe(400);
  });

  it('rejects an invalid email with a 400', async () => {
    setupService({});

    const response = await PATCH(patchRequest({ inviteeEmails: ['not-an-email'] }), { params });

    expect(response.status).toBe(400);
  });
});
