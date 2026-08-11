import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockServiceClient = vi.fn();
const mockSendMeetingInvites = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => mockServiceClient(),
}));

vi.mock('@/app/actions/meetings', () => ({
  sendMeetingInvites: (...args: unknown[]) => mockSendMeetingInvites(...args),
}));

import { createClient } from '@/lib/supabase/server';

const SESSION_ID = 'sched-1';
const createParams = (id: string) => ({ params: Promise.resolve({ id }) });

const baseSession = {
  id: SESSION_ID,
  host_user_id: mockUser.id,
  title: 'Design sync',
  description: 'Weekly',
  scheduled_at: '2026-09-01T15:00:00.000Z',
  duration_minutes: 60,
  join_code: 'ABC123',
  status: 'pending',
};

interface Invitee {
  id: string;
  email: string;
  name: string | null;
  rsvp_status?: string;
  invite_token?: string;
}

/**
 * Builds the service-client mock the routes talk to. `session` is what the
 * scheduled_sessions lookup returns (null = not found / not owned), and
 * `inserted` is what the invitee insert echoes back.
 */
function buildServiceClient(opts: {
  session: (typeof baseSession & { scheduled_session_invitees: Invitee[] }) | null;
  inserted?: Invitee[];
  insertError?: { message: string } | null;
  onInsert?: (rows: unknown) => void;
}) {
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'scheduled_sessions') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.session, error: null }),
      };
    }
    if (table === 'scheduled_session_invitees') {
      return {
        insert: vi.fn().mockImplementation((rows: unknown) => {
          opts.onInsert?.(rows);
          return {
            select: vi.fn().mockResolvedValue({
              data: opts.insertError ? null : (opts.inserted ?? []),
              error: opts.insertError ?? null,
            }),
          };
        }),
      };
    }
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { display_name: 'Test User' },
          error: null,
        }),
      };
    }
    return {};
  });
  return { from };
}

function postRequest(body: unknown) {
  return new Request(`http://localhost/api/scheduled-sessions/${SESSION_ID}/invitees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
  mockSendMeetingInvites.mockResolvedValue({ ok: true });
  vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient() as never);
});

describe('GET /api/scheduled-sessions/[id]/invitees', () => {
  it('lists invitees without leaking invite tokens', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: {
          ...baseSession,
          scheduled_session_invitees: [
            {
              id: 'inv-1',
              email: 'a@example.com',
              name: 'A',
              rsvp_status: 'accepted',
              invite_token: 'secret-token',
            },
          ],
        },
      })
    );

    const request = new Request(`http://localhost/api/scheduled-sessions/${SESSION_ID}/invitees`);
    const response = await GET(request, createParams(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe('a@example.com');
    expect(body.data[0]).not.toHaveProperty('invite_token');
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: new Error('nope') });

    const request = new Request(`http://localhost/api/scheduled-sessions/${SESSION_ID}/invitees`);
    const response = await GET(request, createParams(SESSION_ID));

    expect(response.status).toBe(401);
  });

  it('returns 404 for a session the caller does not host', async () => {
    mockServiceClient.mockReturnValue(buildServiceClient({ session: null }));

    const request = new Request(`http://localhost/api/scheduled-sessions/${SESSION_ID}/invitees`);
    const response = await GET(request, createParams(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Scheduled session not found');
  });
});

describe('POST /api/scheduled-sessions/[id]/invitees', () => {
  it('adds invitees and emails only the new ones', async () => {
    let insertedRows: unknown;
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: {
          ...baseSession,
          scheduled_session_invitees: [
            { id: 'inv-1', email: 'existing@example.com', name: null, rsvp_status: 'pending' },
          ],
        },
        inserted: [
          {
            id: 'inv-2',
            email: 'new@example.com',
            name: 'New Person',
            rsvp_status: 'pending',
            invite_token: 'tok-2',
          },
        ],
        onInsert: (rows) => {
          insertedRows = rows;
        },
      })
    );

    const response = await POST(
      postRequest({
        invitees: [{ email: 'New@Example.com ', name: 'New Person' }, 'existing@example.com'],
      }),
      createParams(SESSION_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.added).toHaveLength(1);
    expect(body.data.added[0].email).toBe('new@example.com');
    expect(body.data.skipped).toEqual(['existing@example.com']);
    expect(body.data.invitee_count).toBe(2);

    // The email is normalised before it reaches the UNIQUE (session, email) index
    expect(insertedRows).toEqual([
      expect.objectContaining({
        scheduled_session_id: SESSION_ID,
        email: 'new@example.com',
        name: 'New Person',
      }),
    ]);

    expect(mockSendMeetingInvites).toHaveBeenCalledTimes(1);
    expect(mockSendMeetingInvites).toHaveBeenCalledWith(
      expect.objectContaining({
        joinCode: 'ABC123',
        title: 'Design sync',
        invitees: [{ email: 'new@example.com', name: 'New Person', token: 'tok-2' }],
      })
    );
  });

  it('accepts bare email strings', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: { ...baseSession, scheduled_session_invitees: [] },
        inserted: [
          {
            id: 'inv-9',
            email: 'plain@example.com',
            name: null,
            rsvp_status: 'pending',
            invite_token: 'tok-9',
          },
        ],
      })
    );

    const response = await POST(
      postRequest({ invitees: ['plain@example.com'] }),
      createParams(SESSION_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.added[0].email).toBe('plain@example.com');
  });

  it('collapses duplicates within a single request', async () => {
    let insertedRows: unknown[] = [];
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: { ...baseSession, scheduled_session_invitees: [] },
        inserted: [
          {
            id: 'inv-3',
            email: 'dup@example.com',
            name: 'First',
            rsvp_status: 'pending',
            invite_token: 'tok-3',
          },
        ],
        onInsert: (rows) => {
          insertedRows = rows as unknown[];
        },
      })
    );

    await POST(
      postRequest({
        invitees: [
          { email: 'dup@example.com', name: 'First' },
          { email: 'DUP@example.com', name: 'Second' },
        ],
      }),
      createParams(SESSION_ID)
    );

    expect(insertedRows).toEqual([
      expect.objectContaining({ email: 'dup@example.com', name: 'First' }),
    ]);
  });

  it('is a no-op when every invitee is already on the list', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: {
          ...baseSession,
          scheduled_session_invitees: [
            { id: 'inv-1', email: 'existing@example.com', name: null, rsvp_status: 'pending' },
          ],
        },
      })
    );

    const response = await POST(
      postRequest({ invitees: ['existing@example.com'] }),
      createParams(SESSION_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.added).toEqual([]);
    expect(body.data.skipped).toEqual(['existing@example.com']);
    expect(mockSendMeetingInvites).not.toHaveBeenCalled();
  });

  it('rejects going past the 50-invitee ceiling', async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({
      id: `inv-${String(i)}`,
      email: `person${String(i)}@example.com`,
      name: null,
      rsvp_status: 'pending',
    }));
    mockServiceClient.mockReturnValue(
      buildServiceClient({ session: { ...baseSession, scheduled_session_invitees: existing } })
    );

    const response = await POST(
      postRequest({ invitees: ['one-too-many@example.com'] }),
      createParams(SESSION_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('at most 50 invitees');
    expect(mockSendMeetingInvites).not.toHaveBeenCalled();
  });

  it('refuses to invite to a cancelled meeting', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: { ...baseSession, status: 'cancelled', scheduled_session_invitees: [] },
      })
    );

    const response = await POST(
      postRequest({ invitees: ['late@example.com'] }),
      createParams(SESSION_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Cannot invite to a cancelled meeting');
  });

  it('rejects an invalid email address', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({ session: { ...baseSession, scheduled_session_invitees: [] } })
    );

    const response = await POST(postRequest({ invitees: ['not-an-email'] }), createParams(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid email address');
  });

  it('rejects an empty invitee list', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({ session: { ...baseSession, scheduled_session_invitees: [] } })
    );

    const response = await POST(postRequest({ invitees: [] }), createParams(SESSION_ID));

    expect(response.status).toBe(400);
  });

  it('surfaces a database insert failure', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: { ...baseSession, scheduled_session_invitees: [] },
        insertError: { message: 'duplicate key value violates unique constraint' },
      })
    );

    const response = await POST(
      postRequest({ invitees: ['x@example.com'] }),
      createParams(SESSION_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('duplicate key');
    expect(mockSendMeetingInvites).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: new Error('nope') });

    const response = await POST(
      postRequest({ invitees: ['a@example.com'] }),
      createParams(SESSION_ID)
    );

    expect(response.status).toBe(401);
  });
});
