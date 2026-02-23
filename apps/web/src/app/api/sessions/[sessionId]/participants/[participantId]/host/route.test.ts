import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

const createParams = (sessionId: string, participantId: string) => ({
  params: Promise.resolve({ sessionId, participantId }),
});

describe('PATCH /api/sessions/[sessionId]/participants/[participantId]/host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('transfers host successfully', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: { id: 'session-1', current_host_id: 'new-host-user' },
        error: null,
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await PATCH(
      new Request('http://localhost/api/sessions/session-1/participants/p-2/host', {
        method: 'PATCH',
      }),
      createParams('session-1', 'p-2')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.current_host_id).toBe('new-host-user');
    expect(mockSupabase.rpc).toHaveBeenCalledWith('transfer_host', {
      p_session_id: 'session-1',
      p_new_host_participant_id: 'p-2',
    });
  });

  it('returns 401 when unauthenticated', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await PATCH(
      new Request('http://localhost/api/sessions/session-1/participants/p-2/host', {
        method: 'PATCH',
      }),
      createParams('session-1', 'p-2')
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when RPC fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Session not found or you are not authorized to transfer host' },
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await PATCH(
      new Request('http://localhost/api/sessions/session-1/participants/p-2/host', {
        method: 'PATCH',
      }),
      createParams('session-1', 'p-2')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('authorized');
  });
});
