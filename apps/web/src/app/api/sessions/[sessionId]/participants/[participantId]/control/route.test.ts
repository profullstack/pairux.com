import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockAdminCreateClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockAdminCreateClient(...args),
}));

import { createClient } from '@/lib/supabase/server';

const createParams = (sessionId: string, participantId: string) => ({
  params: Promise.resolve({ sessionId, participantId }),
});

function createRequest(control_state: 'granted' | 'view-only' | 'requested') {
  return new Request('http://localhost/api/sessions/session-1/participants/p-2/control', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ control_state }),
  });
}

describe('PATCH /api/sessions/[sessionId]/participants/[participantId]/control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  });

  it('allows authenticated active participant to grant control', async () => {
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: { id: 'session-1', host_user_id: 'host-user', current_host_id: 'host-user' },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'participant-self' }, error: null });
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const adminUpdateChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'p-2', control_state: 'granted', display_name: 'Viewer' },
        error: null,
      }),
    };
    const adminFrom = vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue(adminUpdateChain),
    });
    mockAdminCreateClient.mockReturnValue({
      from: adminFrom,
    });

    const response = await PATCH(createRequest('granted'), createParams('session-1', 'p-2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.control_state).toBe('granted');
    expect(mockAdminCreateClient).toHaveBeenCalled();
  });

  it('rejects non-participant non-host', async () => {
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: { id: 'session-1', host_user_id: 'host-user', current_host_id: 'host-user' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await PATCH(createRequest('granted'), createParams('session-1', 'p-2'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized to manage control in this session');
  });
});
