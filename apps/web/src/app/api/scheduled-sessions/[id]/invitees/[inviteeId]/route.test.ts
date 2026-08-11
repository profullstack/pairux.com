import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockServiceClient = vi.fn();
const mockSendInviteeRemoval = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => mockServiceClient(),
}));

vi.mock('@/app/actions/meetings', () => ({
  sendInviteeRemoval: (...args: unknown[]) => mockSendInviteeRemoval(...args),
}));

import { createClient } from '@/lib/supabase/server';

const SESSION_ID = 'sched-1';
const INVITEE_ID = 'inv-1';

const createParams = (id: string, inviteeId: string) => ({
  params: Promise.resolve({ id, inviteeId }),
});

const invitee = {
  id: INVITEE_ID,
  scheduled_session_id: SESSION_ID,
  email: 'a@example.com',
  name: 'A',
  rsvp_status: 'pending',
  invite_token: 'secret-token',
};

const baseSession = {
  id: SESSION_ID,
  host_user_id: mockUser.id,
  title: 'Design sync',
  description: null,
  scheduled_at: '2026-09-01T15:00:00.000Z',
  duration_minutes: 60,
  join_code: 'ABC123',
  status: 'pending',
  scheduled_session_invitees: [invitee],
};

function buildServiceClient(opts: {
  session: typeof baseSession | null;
  deleteError?: { message: string } | null;
  updated?: Record<string, unknown> | null;
  onDelete?: (filters: Record<string, string>) => void;
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
      const deleteFilters: Record<string, string> = {};
      const deleteChain = {
        eq: vi.fn().mockImplementation((col: string, val: string) => {
          deleteFilters[col] = val;
          // The route applies exactly two filters; resolve on the second
          if (Object.keys(deleteFilters).length === 2) {
            opts.onDelete?.(deleteFilters);
            return Promise.resolve({ error: opts.deleteError ?? null });
          }
          return deleteChain;
        }),
      };
      return {
        delete: vi.fn().mockReturnValue(deleteChain),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: opts.updated ?? null,
            error: opts.updated ? null : { message: 'not found' },
          }),
        }),
      };
    }
    return {};
  });
  return { from };
}

function deleteRequest(query = '') {
  return new Request(
    `http://localhost/api/scheduled-sessions/${SESSION_ID}/invitees/${INVITEE_ID}${query}`,
    { method: 'DELETE' }
  );
}

function patchRequest(body: unknown) {
  return new Request(
    `http://localhost/api/scheduled-sessions/${SESSION_ID}/invitees/${INVITEE_ID}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
  mockSendInviteeRemoval.mockResolvedValue({ ok: true });
  vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient() as never);
});

describe('DELETE /api/scheduled-sessions/[id]/invitees/[inviteeId]', () => {
  it('removes the invitee and sends no email by default', async () => {
    let filters: Record<string, string> = {};
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: baseSession,
        onDelete: (f) => {
          filters = f;
        },
      })
    );

    const response = await DELETE(deleteRequest(), createParams(SESSION_ID, INVITEE_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.removed.email).toBe('a@example.com');
    expect(body.data.removed).not.toHaveProperty('invite_token');
    expect(body.data.notified).toBe(false);
    expect(body.data.invitee_count).toBe(0);
    // Scoped to the parent session so an id alone cannot delete across meetings
    expect(filters).toEqual({ id: INVITEE_ID, scheduled_session_id: SESSION_ID });
    expect(mockSendInviteeRemoval).not.toHaveBeenCalled();
  });

  it('emails the invitee when notify=true', async () => {
    mockServiceClient.mockReturnValue(buildServiceClient({ session: baseSession }));

    const response = await DELETE(
      deleteRequest('?notify=true'),
      createParams(SESSION_ID, INVITEE_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.notified).toBe(true);
    expect(mockSendInviteeRemoval).toHaveBeenCalledWith({
      title: 'Design sync',
      scheduledAt: baseSession.scheduled_at,
      inviteeEmail: 'a@example.com',
      inviteeName: 'A',
    });
  });

  it('still reports success when the removal email fails', async () => {
    mockSendInviteeRemoval.mockResolvedValue({ ok: false, error: 'resend down' });
    mockServiceClient.mockReturnValue(buildServiceClient({ session: baseSession }));

    const response = await DELETE(
      deleteRequest('?notify=true'),
      createParams(SESSION_ID, INVITEE_ID)
    );

    expect(response.status).toBe(200);
  });

  it('returns 404 for a session the caller does not host', async () => {
    mockServiceClient.mockReturnValue(buildServiceClient({ session: null }));

    const response = await DELETE(deleteRequest(), createParams(SESSION_ID, INVITEE_ID));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Scheduled session not found');
  });

  it('returns 404 when the invitee belongs to another meeting', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({ session: { ...baseSession, scheduled_session_invitees: [] } })
    );

    const response = await DELETE(deleteRequest(), createParams(SESSION_ID, INVITEE_ID));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Invitee not found');
  });

  it('surfaces a database delete failure', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({ session: baseSession, deleteError: { message: 'delete blocked' } })
    );

    const response = await DELETE(deleteRequest(), createParams(SESSION_ID, INVITEE_ID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('delete blocked');
    expect(mockSendInviteeRemoval).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: new Error('nope') });

    const response = await DELETE(deleteRequest(), createParams(SESSION_ID, INVITEE_ID));

    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/scheduled-sessions/[id]/invitees/[inviteeId]', () => {
  it('updates the display name', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: baseSession,
        updated: { ...invitee, name: 'Renamed' },
      })
    );

    const response = await PATCH(
      patchRequest({ name: 'Renamed' }),
      createParams(SESSION_ID, INVITEE_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Renamed');
    expect(body.data).not.toHaveProperty('invite_token');
  });

  it('updates the RSVP status', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({
        session: baseSession,
        updated: { ...invitee, rsvp_status: 'accepted' },
      })
    );

    const response = await PATCH(
      patchRequest({ rsvpStatus: 'accepted' }),
      createParams(SESSION_ID, INVITEE_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.rsvp_status).toBe('accepted');
  });

  it('rejects an empty patch', async () => {
    mockServiceClient.mockReturnValue(buildServiceClient({ session: baseSession }));

    const response = await PATCH(patchRequest({}), createParams(SESSION_ID, INVITEE_ID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Nothing to update');
  });

  it('rejects an unknown RSVP status', async () => {
    mockServiceClient.mockReturnValue(buildServiceClient({ session: baseSession }));

    const response = await PATCH(
      patchRequest({ rsvpStatus: 'maybe' }),
      createParams(SESSION_ID, INVITEE_ID)
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 when the invitee is not on this meeting', async () => {
    mockServiceClient.mockReturnValue(
      buildServiceClient({ session: { ...baseSession, scheduled_session_invitees: [] } })
    );

    const response = await PATCH(
      patchRequest({ name: 'Renamed' }),
      createParams(SESSION_ID, INVITEE_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Invitee not found');
  });
});
