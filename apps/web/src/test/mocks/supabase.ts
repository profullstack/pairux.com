import { vi } from 'vitest';

export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  user_metadata: {
    display_name: 'Test User',
  },
};

export const mockProfile = {
  id: 'test-user-id',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

export const mockSession = {
  id: 'test-session-id',
  join_code: 'ABC123',
  host_user_id: 'test-user-id',
  status: 'active',
  settings: { quality: 'medium', allowControl: false, maxParticipants: 5 },
  created_at: '2024-01-01T00:00:00Z',
  ended_at: null,
};

export function createMockSupabaseClient(overrides: Record<string, unknown> = {}) {
  const defaultAuth = {
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { user: mockUser, session: { access_token: 'test-token' } },
      error: null,
    }),
    signUp: vi.fn().mockResolvedValue({
      data: { user: mockUser, session: null },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({
      data: { user: mockUser },
      error: null,
    }),
    updateUser: vi.fn().mockResolvedValue({
      data: { user: mockUser },
      error: null,
    }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    ...overrides.auth,
  };

  const defaultFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
    order: vi.fn().mockReturnThis(),
    then: vi.fn().mockResolvedValue({ data: [], error: null }),
  });

  return {
    auth: defaultAuth,
    from: overrides.from ?? defaultFrom,
    rpc: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    ...overrides,
  };
}

// Mock the createClient function
export const mockCreateClient = vi.fn(() => createMockSupabaseClient());
