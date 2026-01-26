import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createMockSupabaseClient, mockUser, mockProfile } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

describe('GET /api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns user and profile for authenticated user', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user.id).toBe(mockUser.id);
    expect(body.data.user.email).toBe(mockUser.email);
    expect(body.data.profile).toEqual(mockProfile);
  });

  it('returns null user and profile for unauthenticated request', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user).toBeNull();
    expect(body.data.profile).toBeNull();
  });

  it('returns null when auth error occurs', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({
      user: null,
      error: { message: 'Session expired' },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user).toBeNull();
    expect(body.data.profile).toBeNull();
  });

  it('returns user with null profile for new users', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Row not found' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user).toBeDefined();
    expect(body.data.profile).toBeNull();
  });

  it('logs profile fetch errors (non-PGRST116)', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'OTHER_ERROR', message: 'Database error' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET();

    expect(console.error).toHaveBeenCalledWith(
      'Profile fetch error:',
      expect.objectContaining({ code: 'OTHER_ERROR' })
    );
    expect(response.status).toBe(200);
  });
});
