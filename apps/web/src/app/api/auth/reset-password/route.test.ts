import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets password successfully', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        updateUser: vi.fn().mockResolvedValue({ error: null }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
        confirmPassword: 'NewPassword123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toBe('Password updated successfully');
    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
      password: 'NewPassword123',
    });
  });

  it('returns 400 for password mismatch', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
        confirmPassword: 'DifferentPassword123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Passwords do not match');
  });

  it('returns 400 for weak password (no uppercase)', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'newpassword123',
        confirmPassword: 'newpassword123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('uppercase');
  });

  it('returns 400 for weak password (no number)', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword',
        confirmPassword: 'NewPassword',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('number');
  });

  it('returns 400 for short password', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'Pass1',
        confirmPassword: 'Pass1',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('8 characters');
  });

  it('returns 400 when supabase returns error', async () => {
    const mockSupabase = createMockSupabaseClient({
      auth: {
        updateUser: vi.fn().mockResolvedValue({
          error: { message: 'Session expired' },
        }),
      },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
        confirmPassword: 'NewPassword123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session expired');
  });
});
