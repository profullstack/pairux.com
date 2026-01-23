import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

// Mock the @supabase/supabase-js module
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';

describe('POST /api/auth/reset-password', () => {
  const mockGetUser = vi.fn();
  const mockUpdateUserById = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up environment variables
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

    // Default mock implementation
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: mockGetUser,
        admin: {
          updateUserById: mockUpdateUserById,
        },
      },
    } as never);
  });

  it('resets password successfully', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    });
    mockUpdateUserById.mockResolvedValue({ error: null });

    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
        accessToken: 'valid-access-token',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toBe('Password updated successfully');
    expect(mockGetUser).toHaveBeenCalledWith('valid-access-token');
    expect(mockUpdateUserById).toHaveBeenCalledWith('user-123', {
      password: 'NewPassword123',
    });
  });

  it('returns 400 for missing access token', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    // Zod returns "Required" for missing required fields
    expect(body.error).toBeDefined();
  });

  it('returns 400 for weak password (no uppercase)', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'newpassword123',
        accessToken: 'valid-access-token',
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
        accessToken: 'valid-access-token',
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
        accessToken: 'valid-access-token',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('8 characters');
  });

  it('returns 400 for invalid or expired token', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });

    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
        accessToken: 'invalid-access-token',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid or expired reset link');
  });

  it('returns 500 when password update fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    });
    mockUpdateUserById.mockResolvedValue({
      error: { message: 'Update failed' },
    });

    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
        accessToken: 'valid-access-token',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to update password. Please try again.');
  });
});
