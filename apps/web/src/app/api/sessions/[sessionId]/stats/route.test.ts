import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/sessions/[sessionId]/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const validStats = {
    participantId: 'test-user-id',
    role: 'host',
    timestamp: Date.now(),
    connectionState: 'connected',
    bytesSent: 1234567,
    bytesReceived: 123456,
    packetsSent: 1000,
    packetsReceived: 950,
    packetsLost: 50,
    roundTripTime: 45.5,
    jitter: 2.3,
    frameRate: 30,
    frameWidth: 1920,
    frameHeight: 1080,
    reportInterval: 30000,
  };

  const createRequest = (sessionId: string, body: unknown) =>
    new Request(`http://localhost/api/sessions/${sessionId}/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('records stats successfully for host', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        };
      }
      // session_usage table
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', validStats), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.recorded).toBe(true);
  });

  it('records stats for viewer participant', async () => {
    const viewerStats = { ...validStats, role: 'viewer', participantId: 'viewer-id' };
    const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };
    const mockParticipant = { id: 'viewer-id' };

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockParticipant, error: null }),
        };
      }
      // session_usage table
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await POST(createRequest('test-session-id', viewerStats), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.recorded).toBe(true);
  });

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

    const response = await POST(createRequest('nonexistent', validStats), {
      params: Promise.resolve({ sessionId: 'nonexistent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  it('returns 403 for unauthorized participant', async () => {
    const viewerStats = { ...validStats, role: 'viewer', participantId: 'unauthorized-id' };
    const otherUserSession = { ...mockSession, host_user_id: 'other-user-id' };

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: otherUserSession, error: null }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await POST(createRequest('test-session-id', viewerStats), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized');
  });

  it('returns 400 for invalid stats format', async () => {
    const invalidStats = {
      participantId: 'test-user-id',
      // missing required fields
    };

    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', invalidStats), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid connection state', async () => {
    const invalidStats = {
      ...validStats,
      connectionState: 'invalid-state',
    };

    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('test-session-id', invalidStats), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('records stats even when insert fails (non-blocking)', async () => {
    // Use unique session/participant to avoid rate limiter from previous tests
    const uniqueStats = { ...validStats, participantId: 'unique-participant-for-insert-test' };
    const uniqueSession = { ...mockSession, id: 'unique-session-for-insert-test' };

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: uniqueSession, error: null }),
        };
      }
      // session_usage table - returns error
      return {
        insert: vi.fn().mockResolvedValue({ error: { message: 'Database error' } }),
      };
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await POST(createRequest('unique-session-for-insert-test', uniqueStats), {
      params: Promise.resolve({ sessionId: 'unique-session-for-insert-test' }),
    });
    const body = await response.json();

    // Should still return success even if insert fails
    expect(response.status).toBe(200);
    expect(body.data.recorded).toBe(true);
  });
});

describe('GET /api/sessions/[sessionId]/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const createRequest = (sessionId: string) =>
    new Request(`http://localhost/api/sessions/${sessionId}/stats`, {
      method: 'GET',
    });

  const mockUsageRecords = [
    {
      id: 'usage-1',
      session_id: 'test-session-id',
      participant_id: 'test-user-id',
      user_id: 'test-user-id',
      role: 'host',
      bytes_sent: 1000000,
      bytes_received: 100000,
      packets_sent: 500,
      packets_received: 480,
      packets_lost: 20,
      round_trip_time: 45,
      jitter: 2,
      frame_rate: 30,
      frame_width: 1920,
      frame_height: 1080,
      connection_state: 'connected',
      report_interval_ms: 30000,
      reported_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'usage-2',
      session_id: 'test-session-id',
      participant_id: 'viewer-1',
      user_id: null,
      role: 'viewer',
      bytes_sent: 10000,
      bytes_received: 900000,
      packets_sent: 50,
      packets_received: 450,
      packets_lost: 10,
      round_trip_time: 50,
      jitter: 3,
      frame_rate: 29,
      frame_width: 1920,
      frame_height: 1080,
      connection_state: 'connected',
      report_interval_ms: 30000,
      reported_at: '2024-01-01T00:00:30Z',
      created_at: '2024-01-01T00:00:30Z',
    },
  ];

  it('returns aggregated stats for host', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        };
      }
      // session_usage table
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockUsageRecords, error: null }),
      };
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

    expect(response.status).toBe(200);
    expect(body.data.sessionId).toBe('test-session-id');
    expect(body.data.totalBytesSent).toBe(1010000); // 1000000 + 10000
    expect(body.data.totalBytesReceived).toBe(1000000); // 100000 + 900000
    expect(body.data.totalBytesTransferred).toBe(2010000);
    expect(body.data.participants).toHaveLength(2);
    expect(body.data.reportCount).toBe(2);
  });

  it('returns 401 for unauthenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

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

  it('returns 403 for non-host user', async () => {
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
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET(createRequest('test-session-id'), {
      params: Promise.resolve({ sessionId: 'test-session-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Only the host can view session stats');
  });

  it('returns empty stats when no usage records', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        };
      }
      // session_usage table - empty
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
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

    expect(response.status).toBe(200);
    expect(body.data.totalBytesSent).toBe(0);
    expect(body.data.totalBytesReceived).toBe(0);
    expect(body.data.totalBytesTransferred).toBe(0);
    expect(body.data.participants).toHaveLength(0);
    expect(body.data.reportCount).toBe(0);
  });

  it('returns 500 when database query fails', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        };
      }
      // session_usage table - error
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } }),
      };
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

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to fetch stats');
  });
});
