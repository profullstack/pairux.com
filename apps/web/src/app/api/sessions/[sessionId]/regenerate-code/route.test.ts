import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

const createParams = (sessionId: string) => ({
  params: Promise.resolve({ sessionId }),
});

describe('POST /api/sessions/[sessionId]/regenerate-code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('regenerates join code for authenticated creator', async () => {
    const updatedSession = { ...mockSession, join_code: 'NEW123' };
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: updatedSession,
        error: null,
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/test-session-id/regenerate-code', {
      method: 'POST',
    });
    const response = await POST(request, createParams('test-session-id'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.join_code).toBe('NEW123');
    expect(mockSupabase.rpc).toHaveBeenCalledWith('regenerate_join_code', {
      p_session_id: 'test-session-id',
    });
  });

  it('returns 401 for unauthenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/test-session-id/regenerate-code', {
      method: 'POST',
    });
    const response = await POST(request, createParams('test-session-id'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when RPC fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Session not found or you are not the creator' },
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/test-session-id/regenerate-code', {
      method: 'POST',
    });
    const response = await POST(request, createParams('test-session-id'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session not found or you are not the creator');
  });
});
