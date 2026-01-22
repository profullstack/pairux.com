import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs out successfully', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toBe('Logged out successfully');
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  it('returns 400 when signOut fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        signOut: vi.fn().mockResolvedValue({
          error: { message: 'Failed to sign out' },
        }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Failed to sign out');
  });

  it('handles unexpected errors', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('Connection failed'));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBeDefined();
  });
});
