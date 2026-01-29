import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';
import { CORS_HEADERS } from '@/lib/cors';

const mockGetAuthenticatedUser = vi.fn();
const mockCreateSupabaseClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateSupabaseClient(...args),
}));

import { createClient } from '@/lib/supabase/server';

describe('GET /api/sessions/[sessionId]/signal/stream', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Set up env vars for token auth tests
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const createRequest = (
    sessionId: string,
    options?: { participantId?: string; token?: string }
  ) => {
    const params = new URLSearchParams();
    if (options?.participantId) params.set('participantId', options.participantId);
    if (options?.token) params.set('token', options.token);
    const queryString = params.toString();
    const url = queryString
      ? `http://localhost/api/sessions/${sessionId}/signal/stream?${queryString}`
      : `http://localhost/api/sessions/${sessionId}/signal/stream`;
    return new Request(url, {
      method: 'GET',
    });
  };

  it('returns 404 when session not found', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET(createRequest('nonexistent'), {
      params: Promise.resolve({ sessionId: 'nonexistent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  it('returns 410 when session has ended', async () => {
    const endedSession = { ...mockSession, status: 'ended' };
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: endedSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toBe('Session has ended');
  });

  it('returns 401 when unauthenticated and no participantId', async () => {
    const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns SSE stream for authenticated host', async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockImplementation((_callback) => {
        // Don't call the callback to avoid the streaming logic
        return mockChannel;
      }),
      track: vi.fn().mockResolvedValue('ok'),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('returns SSE stream for guest with participantId', async () => {
    const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      track: vi.fn().mockResolvedValue('ok'),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await GET(
      createRequest('test-session-id', { participantId: 'guest-participant-id' }),
      {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('subscribes to correct channel', async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      track: vi.fn().mockResolvedValue('ok'),
    };

    const channelFn = vi.fn().mockReturnValue(mockChannel);

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: channelFn,
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    expect(channelFn).toHaveBeenCalledWith('session:test-session-id', {
      config: {
        broadcast: { self: false },
      },
    });
  });

  it('sets up broadcast and presence listeners', async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      track: vi.fn().mockResolvedValue('ok'),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    // Check that 'on' was called for broadcast and presence events
    expect(mockChannel.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'signal' },
      expect.any(Function)
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      'presence',
      { event: 'join' },
      expect.any(Function)
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      'presence',
      { event: 'leave' },
      expect.any(Function)
    );
  });

  // Token-based authentication tests (for desktop app)
  describe('token-based authentication', () => {
    it('returns SSE stream for authenticated host via token', async () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue('ok'),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
        },
      });
      mockCreateSupabaseClient.mockReturnValue(mockSupabase);

      const response = await GET(createRequest('test-session-id', { token: 'valid-token' }), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      // Verify createSupabaseClient was called with token in headers
      expect(mockCreateSupabaseClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'test-anon-key',
        expect.objectContaining({
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: 'Bearer valid-token' } },
        })
      );
    });

    it('returns 500 when env vars missing for token auth', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const response = await GET(createRequest('test-session-id', { token: 'some-token' }), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Server configuration error');
    });

    it('returns 401 when token is invalid and no participantId', async () => {
      const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        auth: {
          getUser: vi
            .fn()
            .mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } }),
        },
      });
      mockCreateSupabaseClient.mockReturnValue(mockSupabase);

      const response = await GET(createRequest('test-session-id', { token: 'invalid-token' }), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Authentication required');
    });

    it('allows token auth with participantId as fallback', async () => {
      const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue('ok'),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
      });
      mockCreateSupabaseClient.mockReturnValue(mockSupabase);

      // Token is invalid but participantId provided as fallback
      const response = await GET(
        createRequest('test-session-id', { token: 'invalid-token', participantId: 'guest-id' }),
        { params: Promise.resolve({ sessionId: 'test-session-id' }) }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    });
  });

  // CORS headers tests (desktop app uses file:// origin)
  describe('CORS headers', () => {
    it('includes CORS headers on SSE stream response', async () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue('ok'),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

      const response = await GET(createRequest('test-session-id'), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });

      expect(response.status).toBe(200);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        expect(response.headers.get(key)).toBe(value);
      }
    });

    it('includes CORS headers on error responses', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

      const response = await GET(createRequest('nonexistent'), {
        params: Promise.resolve({ sessionId: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('includes CORS headers on 401 response', async () => {
      const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

      const response = await GET(createRequest('test-session-id'), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ICE server configuration tests
  describe('ICE servers in connected event', () => {
    it('includes STUN servers in connected event', async () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue('ok'),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

      const response = await GET(createRequest('test-session-id'), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });

      expect(response.status).toBe(200);

      // Read the first chunk from the stream to get the connected event
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // The connected event should contain iceServers with at least STUN
      expect(text).toContain('event: connected');
      expect(text).toContain('iceServers');
      expect(text).toContain('stun:stun.l.google.com:19302');
      reader.releaseLock();
    });

    it('includes TURN server when env vars are set', async () => {
      process.env.TURN_SERVER_URL = 'turn:turn.example.com:3478';
      process.env.TURN_SERVER_USERNAME = 'testuser';
      process.env.TURN_SERVER_CREDENTIAL = 'testcred';

      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue('ok'),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

      const response = await GET(createRequest('test-session-id'), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });

      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain('turn:turn.example.com:3478');
      expect(text).toContain('testuser');
      reader.releaseLock();
    });

    it('does not include TURN server when env vars are missing', async () => {
      delete process.env.TURN_SERVER_URL;
      delete process.env.TURN_SERVER_USERNAME;
      delete process.env.TURN_SERVER_CREDENTIAL;

      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue('ok'),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
      mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

      const response = await GET(createRequest('test-session-id'), {
        params: Promise.resolve({ sessionId: 'test-session-id' }),
      });

      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      // Should have STUN but no TURN
      expect(text).toContain('stun:stun.l.google.com:19302');
      expect(text).not.toContain('turn:');
      reader.releaseLock();
    });
  });
});
