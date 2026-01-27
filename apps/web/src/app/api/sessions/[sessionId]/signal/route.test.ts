import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/sessions/[sessionId]/signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const validSignal = {
    type: 'offer',
    sdp: 'v=0\r\no=- 123 1 IN IP4 127.0.0.1\r\n...',
    senderId: 'test-user-id',
    timestamp: Date.now(),
  };

  const createRequest = (sessionId: string, body: unknown) =>
    new Request(`http://localhost/api/sessions/${sessionId}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('sends signal successfully for host', async () => {
    const mockChannel = {
      subscribe: vi.fn().mockImplementation((callback) => {
        callback('SUBSCRIBED');
        return mockChannel;
      }),
      send: vi.fn().mockResolvedValue('ok'),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', validSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sent).toBe(true);
    expect(mockChannel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'signal',
      payload: expect.objectContaining({
        type: 'offer',
        senderId: 'test-user-id',
      }),
    });
  });

  it('sends ICE candidate signal', async () => {
    const iceSignal = {
      type: 'ice-candidate',
      candidate: {
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
      senderId: 'test-user-id',
      targetId: 'viewer-id',
      timestamp: Date.now(),
    };

    const mockChannel = {
      subscribe: vi.fn().mockImplementation((callback) => {
        callback('SUBSCRIBED');
        return mockChannel;
      }),
      send: vi.fn().mockResolvedValue('ok'),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', iceSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sent).toBe(true);
    expect(mockChannel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'signal',
      payload: expect.objectContaining({
        type: 'ice-candidate',
        targetId: 'viewer-id',
      }),
    });
  });

  it('returns 404 when session not found', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('nonexistent', validSignal), {
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
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: endedSession, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', validSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toBe('Session has ended');
  });

  it('returns 403 when non-host non-participant sends signal', async () => {
    const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
    let callCount = 0;

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call - session lookup
          return Promise.resolve({ data: otherUserSession, error: null });
        }
        // Second call - participant lookup
        return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', validSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized to send signals in this session');
  });

  it('returns 400 for invalid signal type', async () => {
    const invalidSignal = {
      type: 'invalid-type',
      senderId: 'test-user-id',
      timestamp: Date.now(),
    };

    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', invalidSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const incompleteSignal = {
      type: 'offer',
      // missing senderId and timestamp
    };

    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', incompleteSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('allows participant to send signal', async () => {
    const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
    const mockParticipant = { id: 'test-user-id' };
    let callCount = 0;

    const mockChannel = {
      subscribe: vi.fn().mockImplementation((callback) => {
        callback('SUBSCRIBED');
        return mockChannel;
      }),
      send: vi.fn().mockResolvedValue('ok'),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call - session lookup
          return Promise.resolve({ data: otherUserSession, error: null });
        }
        // Second call - participant lookup
        return Promise.resolve({ data: mockParticipant, error: null });
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', validSignal), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sent).toBe(true);
  });
});
