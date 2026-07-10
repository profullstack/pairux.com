import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockAddGrant = vi.fn();
const mockToJwt = vi.fn().mockResolvedValue('mock-jwt-token');
const mockAccessTokenCtor = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('livekit-server-sdk', () => ({
  AccessToken: vi.fn().mockImplementation((...args: unknown[]) => {
    mockAccessTokenCtor(...args);
    return {
      addGrant: mockAddGrant,
      toJwt: mockToJwt,
    };
  }),
}));

import { createClient } from '@/lib/supabase/server';

const validBody = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  participantName: 'Test User',
  participantId: '00000000-0000-0000-0000-000000000002',
  isHost: true,
};

const sfuSession = {
  id: validBody.sessionId,
  mode: 'sfu',
  host_user_id: mockUser.id,
  status: 'active',
};

function createRequest(body: unknown) {
  return new Request('http://localhost/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/livekit/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.LIVEKIT_API_KEY = 'testkey';
    process.env.LIVEKIT_API_SECRET = 'testsecret';
    process.env.NEXT_PUBLIC_LIVEKIT_URL = 'ws://localhost:7880';
  });

  it('returns token for authenticated host', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: sfuSession, error: null }),
    });
    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toBe('mock-jwt-token');
    expect(body.data.roomName).toBe(`session-${validBody.sessionId}`);
    expect(body.data.url).toBe('ws://localhost:7880');
  });

  it('returns token for viewer', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: sfuSession, error: null }),
    });
    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toBe('mock-jwt-token');
  });

  it('allows authenticated participant (non-owner) to publish in SFU mode', async () => {
    const otherOwnerSession = { ...sfuSession, host_user_id: 'other-user-id' };

    const sessionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: otherOwnerSession, error: null }),
    };
    const participantQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'participant-1' }, error: null }),
    };
    // Owner's plan drives the listener cap; free = 5, room has room to spare.
    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan: 'free', plan_expires_at: null },
        error: null,
      }),
    };
    const mockFrom = vi.fn((table: string) => {
      if (table === 'sessions') return sessionQuery;
      if (table === 'session_participants') return participantQuery;
      if (table === 'profiles') return profileQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toBe('mock-jwt-token');
    expect(mockAddGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        canPublish: true,
      })
    );
  });

  it('returns 403 when the room is at the owner plan listener cap', async () => {
    const otherOwnerSession = { ...sfuSession, host_user_id: 'other-user-id' };

    const sessionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: otherOwnerSession, error: null }),
    };
    // Authorized participant, but the free room already holds its 5 listeners.
    const participantQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'participant-1' }, error: null }),
      // The head:true count query is awaited directly (no .single()).
      then: (resolve: (v: unknown) => void) => resolve({ count: 5, data: null, error: null }),
    };
    const profileQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan: 'free', plan_expires_at: null },
        error: null,
      }),
    };
    const mockFrom = vi.fn((table: string) => {
      if (table === 'sessions') return sessionQuery;
      if (table === 'session_participants') return participantQuery;
      if (table === 'profiles') return profileQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('Room is full');
  });

  it('returns 401 for unauthenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 404 for nonexistent session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    });
    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  it('returns 400 for P2P session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { ...sfuSession, mode: 'p2p' },
        error: null,
      }),
    });
    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session is not in SFU mode');
  });

  it('returns 403 when non-host claims host', async () => {
    const sessionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { ...sfuSession, host_user_id: 'other-user-id' },
        error: null,
      }),
    };
    const participantQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const mockFrom = vi.fn((table: string) => {
      if (table === 'sessions') return sessionQuery;
      if (table === 'session_participants') return participantQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized for this session');
  });

  it('returns 400 for ended session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { ...sfuSession, status: 'ended' },
        error: null,
      }),
    });
    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session has ended');
  });

  it('returns 503 when LiveKit not configured', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('LiveKit not configured');
  });

  it('returns 400 for invalid request body', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ sessionId: 'not-a-uuid' }));
    expect(response.status).toBe(400);
  });
});
