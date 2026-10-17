import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockServiceClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => mockServiceClient(),
}));

const mockSendPush = vi.fn().mockResolvedValue({ sent: 1, failed: 0 });
vi.mock('@/lib/push', () => ({
  sendPushToUser: (...args: unknown[]) => mockSendPush(...args),
}));

import { createClient } from '@/lib/supabase/server';

const createParams = (joinCode: string) => ({
  params: Promise.resolve({ joinCode }),
});

describe('GET /api/sessions/join/[joinCode]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns session info for valid join code', async () => {
    const sessionData = {
      id: mockSession.id,
      join_code: 'ABC123',
      status: 'active',
      settings: mockSession.settings,
      created_at: mockSession.created_at,
    };

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: sessionData, error: null }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ count: 2, error: null }),
        };
      }
      return {};
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    const rpc = vi.fn().mockResolvedValue({
      data: [{ participants: 2, listeners: 7, participant_cap: 2, listener_cap: 20 }],
      error: null,
    });
    mockServiceClient.mockReturnValue({ rpc });

    const request = new Request('http://localhost/api/sessions/join/ABC123');
    const response = await GET(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.join_code).toBe('ABC123');
    // The seats join_session counts (host included), not raw rows.
    expect(rpc).toHaveBeenCalledWith('session_seat_usage', { p_session_id: mockSession.id });
    expect(body.data.participant_count).toBe(2);
    expect(body.data.listener_count).toBe(7);
  });

  it('converts join code to uppercase', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((field, value) => {
            // Verify it's being called with uppercase
            if (field === 'join_code') {
              expect(value).toBe('ABC123');
            }
            return {
              neq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test',
                  join_code: 'ABC123',
                  status: 'active',
                  settings: {},
                  created_at: '',
                },
                error: null,
              }),
            };
          }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ count: 0, error: null }),
        };
      }
      return {};
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/sessions/join/abc123');
    await GET(request, createParams('abc123'));
  });

  it('returns scheduled session when no live session exists', async () => {
    const scheduledData = {
      id: 'sched-1',
      join_code: 'ABC123',
      title: 'Team Standup',
      description: 'Daily sync',
      scheduled_at: '2026-06-05T10:00:00.000Z',
      duration_minutes: 30,
      scheduled_session_invitees: [
        { name: 'Alice', rsvp_status: 'accepted' },
        { name: null, rsvp_status: 'pending' },
      ],
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Row not found' },
      }),
    });

    const mockServiceFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: scheduledData, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockServiceClient.mockReturnValue(createMockSupabaseClient({ from: mockServiceFrom }));

    const request = new Request('http://localhost/api/sessions/join/ABC123');
    const response = await GET(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scheduled).toBe(true);
    expect(body.data.id).toBe('sched-1');
    expect(body.data.join_code).toBe('ABC123');
    expect(body.data.title).toBe('Team Standup');
    expect(body.data.description).toBe('Daily sync');
    expect(body.data.scheduled_at).toBe('2026-06-05T10:00:00.000Z');
    expect(body.data.duration_minutes).toBe(30);
    expect(body.data.invitees).toEqual([
      { name: 'Alice', rsvp_status: 'accepted' },
      { name: null, rsvp_status: 'pending' },
    ]);
  });

  it('returns scheduled session with empty invitees when none exist', async () => {
    const scheduledData = {
      id: 'sched-2',
      join_code: 'XYZ789',
      title: 'Solo Session',
      description: null,
      scheduled_at: '2026-06-06T14:00:00.000Z',
      duration_minutes: 60,
      scheduled_session_invitees: [],
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Row not found' },
      }),
    });

    const mockServiceFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: scheduledData, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockServiceClient.mockReturnValue(createMockSupabaseClient({ from: mockServiceFrom }));

    const request = new Request('http://localhost/api/sessions/join/XYZ789');
    const response = await GET(request, createParams('XYZ789'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scheduled).toBe(true);
    expect(body.data.description).toBeNull();
    expect(body.data.invitees).toEqual([]);
  });

  it('returns 404 for non-existent or ended session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Row not found' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    // Service client also finds no scheduled session
    mockServiceClient.mockReturnValue(createMockSupabaseClient({ from: mockFrom }));

    const request = new Request('http://localhost/api/sessions/join/INVALID');
    const response = await GET(request, createParams('INVALID'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found or has ended');
  });

  it('returns 400 on database error', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'OTHER', message: 'Database error' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/sessions/join/ABC123');
    const response = await GET(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Database error');
  });
});

describe('POST /api/sessions/join/[joinCode]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('joins session as authenticated user', async () => {
    const joinResult = {
      session_id: mockSession.id,
      participant_id: 'participant-123',
    };

    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: joinResult, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(joinResult);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: undefined,
    });
  });

  it('joins session as authenticated user with custom display name', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Custom Name' }),
    });
    await POST(request, createParams('ABC123'));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: 'Custom Name',
    });
  });

  it('joins session as guest with display name', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Guest User' }),
    });
    const response = await POST(request, createParams('ABC123'));

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: 'Guest User',
    });
  });

  it('returns 400 when guest has no display name', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Display name is required for guests');
  });

  it('returns 400 when guest display name is too short', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'X' }),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Display name is required for guests');
  });

  it('returns 400 when RPC fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Session not found or has ended' },
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session not found or has ended');
  });

  it('converts join code to uppercase', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/abc123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await POST(request, createParams('abc123'));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: undefined,
    });
  });

  describe('when the room is at its plan cap', () => {
    const room = {
      id: mockSession.id,
      host_user_id: 'host-user-id',
      settings: { maxParticipants: 2 },
    };

    // Service client: the room lookup by join code, then recordCapRefusal's
    // read + write.
    function serviceMock() {
      const updates: unknown[] = [];
      const from = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: room, error: null }),
        update: vi.fn().mockImplementation((value: unknown) => {
          updates.push(value);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      }));
      mockServiceClient.mockReturnValue({ from });
      return updates;
    }

    function joinRequest(body: Record<string, unknown> = {}) {
      return new Request('http://localhost/api/sessions/join/ABC123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('turns the third participant of a Free room away politely and tells the host', async () => {
      const updates = serviceMock();
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Session is full (participants)' } });
      vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient({ rpc }) as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

      const response = await POST(joinRequest(), createParams('ABC123'));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toMatch(/host's plan has no seats left/);
      // join_session reads the owner's plan live, so there is nothing to retry.
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(updates).toEqual([
        {
          settings: expect.objectContaining({
            capRefusedCount: 1,
            capRefusedKind: 'participants',
            maxParticipants: 2,
          }),
        },
      ]);
      expect(mockSendPush).toHaveBeenCalledWith(
        'host-user-id',
        'participantJoined',
        expect.objectContaining({ url: `/host/${mockSession.id}` })
      );
    });

    it('turns an anonymous guest away the same way (guests take seats too)', async () => {
      const updates = serviceMock();
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Session is full (participants)' } });
      vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient({ rpc }) as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

      const response = await POST(joinRequest({ displayName: 'Guest' }), createParams('ABC123'));

      expect(response.status).toBe(403);
      expect(updates).toHaveLength(1);
    });

    it('records a full listener section as such', async () => {
      const updates = serviceMock();
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Session is full (listeners)' } });
      vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient({ rpc }) as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

      const response = await POST(joinRequest({ displayName: 'Guest' }), createParams('ABC123'));

      expect(response.status).toBe(403);
      expect(updates).toEqual([
        { settings: expect.objectContaining({ capRefusedKind: 'listeners' }) },
      ]);
    });
  });
});
