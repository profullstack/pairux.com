import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

describe('GET /api/sessions/[sessionId]/signal/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const createRequest = (sessionId: string, participantId?: string) => {
    const url = participantId
      ? `http://localhost/api/sessions/${sessionId}/signal/stream?participantId=${participantId}`
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

    const response = await GET(createRequest('test-session-id', 'guest-participant-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

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
});
