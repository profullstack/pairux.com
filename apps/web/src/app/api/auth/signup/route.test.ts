import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const upsert = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => ({
    auth: {},
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, opts: unknown) => {
        upsert(table, row, opts);
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
    }),
  }),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates user successfully', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'Password123',
        confirmPassword: 'Password123',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.user.id).toBe(mockUser.id);
    expect(body.data.message).toContain('Check your email');
  });

  it('returns 400 on password mismatch', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'Password123',
        confirmPassword: 'DifferentPassword123',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Passwords do not match');
  });

  it('returns 400 on weak password (no uppercase)', async () => {
    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'password123',
        confirmPassword: 'password123',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('uppercase');
  });

  it('returns 400 on weak password (no number)', async () => {
    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'PasswordABC',
        confirmPassword: 'PasswordABC',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('number');
  });

  it('returns 400 on short password', async () => {
    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'Pass1',
        confirmPassword: 'Pass1',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('8 characters');
  });

  it('returns 400 on invalid email', async () => {
    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'Password123',
        confirmPassword: 'Password123',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('email');
  });

  it('returns 400 on missing first name', async () => {
    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'Password123',
        confirmPassword: 'Password123',
        firstName: '',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('First name is required');
  });

  it('returns 400 when supabase returns error', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'User already registered' },
        }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'existing@example.com',
        password: 'Password123',
        confirmPassword: 'Password123',
        firstName: 'Existing',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('User already registered');
  });

  it('returns 500 when user creation returns null user', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        password: 'Password123',
        confirmPassword: 'Password123',
        firstName: 'New',
        lastName: 'User',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to create user');
  });

  it('stores the profile fields on public.profiles for a new account', async () => {
    const newUser = { ...mockUser, identities: [{ id: 'identity' }] };
    const signUp = vi
      .fn()
      .mockResolvedValue({ data: { user: newUser, session: null }, error: null });
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabaseClient({ auth: { signUp } }) as never
    );

    const response = await POST(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company_domain: 'https://www.Acme.com/about',
          job_title: 'CTO',
          linkedin_url: 'in/ada-lovelace',
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(
      (signUp.mock.calls[0] as [{ options: { data: unknown } }])[0].options.data
    ).toMatchObject({
      company_domain: 'acme.com',
      job_title: 'CTO',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [table, row, opts] = upsert.mock.calls[0] as [string, unknown, unknown];
    expect(table).toBe('profiles');
    expect(opts).toEqual({ onConflict: 'id' });
    expect(row).toMatchObject({
      id: 'test-user-id',
      email: 'test@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_domain: 'acme.com',
      job_title: 'CTO',
      linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
    });
  });

  it('does not write a profile for an already-registered address', async () => {
    upsert.mockClear();
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    const response = await POST(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      })
    );
    expect(response.status).toBe(201);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a link in a name field with a field error', async () => {
    vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient() as never);
    const response = await POST(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          firstName: 'http://spam.example',
          lastName: 'Lovelace',
        }),
      })
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.fieldErrors.first_name).toBeTruthy();
  });
});
