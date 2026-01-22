import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

// Mock the supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user data on successful login', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user.id).toBe(mockUser.id);
    expect(body.data.user.email).toBe(mockUser.email);
  });

  it('returns 401 on invalid credentials', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'wrongpassword',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid login credentials');
  });

  it('returns 400 on invalid email format', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'Password123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('email');
  });

  it('returns 400 on empty password', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: '',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('required');
  });

  it('returns 401 when user is null but no error', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: null,
        }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid credentials');
  });

  it('handles malformed JSON body', async () => {
    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
  });
});
