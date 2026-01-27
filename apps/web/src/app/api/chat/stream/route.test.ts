import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createMockSupabaseClient, mockSession } from '@/test/mocks/supabase';
import { CORS_HEADERS } from '@/lib/cors';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

describe('GET /api/chat/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 400 for invalid session ID', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/chat/stream?sessionId=invalid');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 for missing session ID', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/chat/stream');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 404 for non-existent session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/stream?sessionId=${sessionId}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  it('returns 410 for ended session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { ...mockSession, status: 'ended' },
        error: null,
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/stream?sessionId=${sessionId}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toBe('Session has ended');
  });

  it('returns SSE stream for active session', async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((callback) => {
        // Simulate immediate subscription success
        setTimeout(() => callback('SUBSCRIBED'), 0);
        return mockChannel;
      }),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: mockSession,
        error: null,
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn(),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    // Create request without AbortSignal for test compatibility
    const request = new Request(`http://localhost/api/chat/stream?sessionId=${sessionId}`);

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
  });

  it('sets up realtime subscription correctly', async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: mockSession,
        error: null,
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn(),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    // Create request without AbortSignal for test compatibility
    const request = new Request(`http://localhost/api/chat/stream?sessionId=${sessionId}`);

    await GET(request);

    // Verify channel was created with correct name
    expect(mockSupabase.channel).toHaveBeenCalledWith(`chat:${sessionId}`);

    // Verify postgres_changes listener was set up
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      }),
      expect.any(Function)
    );
  });

  // CORS headers tests (desktop app uses file:// origin)
  describe('CORS headers', () => {
    it('includes CORS headers on SSE stream response', async () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const mockSupabase = createMockSupabaseClient({
        from: mockFrom,
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn(),
      });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

      const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const request = new Request(`http://localhost/api/chat/stream?sessionId=${sessionId}`);
      const response = await GET(request);

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

      const mockSupabase = createMockSupabaseClient({ from: mockFrom });
      vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

      const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const request = new Request(`http://localhost/api/chat/stream?sessionId=${sessionId}`);
      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});
