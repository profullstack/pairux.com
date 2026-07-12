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

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: vi.fn(),
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
import { serviceClient } from '@/lib/supabase/service';

const validBody = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  participantName: 'Test User',
  participantId: '00000000-0000-0000-0000-000000000002',
  isHost: true,
};

// Server-side reads all go through the service client now (guests have no RLS
// session access); getAuthenticatedUser still reads the cookie/bearer client.
const sfuSession = {
  id: validBody.sessionId,
  mode: 'sfu',
  host_user_id: mockUser.id,
  status: 'active',
  is_public: false,
  current_host_id: mockUser.id,
};

// Point both the cookie client and the service client at the same mock.
function useClient(mock: unknown) {
  vi.mocked(createClient).mockResolvedValue(mock as never);
  vi.mocked(serviceClient).mockReturnValue(mock as never);
}

function sessionOnly(session: unknown) {
  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: session, error: null }),
  });
  return createMockSupabaseClient({ from: mockFrom });
}

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
    useClient(sessionOnly(sfuSession));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toBe('mock-jwt-token');
    expect(body.data.roomName).toBe(`session-${validBody.sessionId}`);
    expect(body.data.url).toBe('ws://localhost:7880');
  });

  it('returns token for viewer', async () => {
    useClient(sessionOnly(sfuSession));
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
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'participant-1' }, error: null }),
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
    useClient(createMockSupabaseClient({ from: mockFrom }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toBe('mock-jwt-token');
    expect(mockAddGrant).toHaveBeenCalledWith(expect.objectContaining({ canPublish: true }));
  });

  it('lets a logged-out GUEST watch a public, live room subscribe-only', async () => {
    const publicLive = {
      ...sfuSession,
      host_user_id: 'owner-x',
      current_host_id: 'owner-x',
      is_public: true,
    };
    const sessionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: publicLive, error: null }),
    };
    const participantQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: validBody.participantId },
        error: null,
      }),
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
    useClient(createMockSupabaseClient({ from: mockFrom }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toBe('mock-jwt-token');
    // Guests are watch-only.
    expect(mockAddGrant).toHaveBeenCalledWith(expect.objectContaining({ canPublish: false }));
  });

  it('rejects a guest on a private room (401)', async () => {
    useClient(sessionOnly({ ...sfuSession, is_public: false, current_host_id: 'owner-x' }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Sign in to join this room');
  });

  it('rejects a guest on a public but offline room (401)', async () => {
    useClient(sessionOnly({ ...sfuSession, is_public: true, current_host_id: null }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Sign in to join this room');
  });

  it('returns 403 when the room is at the owner plan listener cap', async () => {
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
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'participant-1' }, error: null }),
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
    useClient(createMockSupabaseClient({ from: mockFrom }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ ...validBody, isHost: false }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('Room is full');
  });

  it('returns 404 for nonexistent session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    });
    useClient(createMockSupabaseClient({ from: mockFrom }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  it('returns 400 for P2P session', async () => {
    useClient(sessionOnly({ ...sfuSession, mode: 'p2p' }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session is not in SFU mode');
  });

  it('returns 403 when authenticated non-host is not a participant', async () => {
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
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const mockFrom = vi.fn((table: string) => {
      if (table === 'sessions') return sessionQuery;
      if (table === 'session_participants') return participantQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    useClient(createMockSupabaseClient({ from: mockFrom }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized for this session');
  });

  it('returns 400 for ended session', async () => {
    useClient(sessionOnly({ ...sfuSession, status: 'ended' }));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session has ended');
  });

  it('returns 503 when LiveKit not configured', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    useClient(createMockSupabaseClient({}));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('LiveKit not configured');
  });

  it('returns 400 for invalid request body', async () => {
    useClient(createMockSupabaseClient({}));
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest({ sessionId: 'not-a-uuid' }));
    expect(response.status).toBe(400);
  });
});
