import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';

const validBody = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
  keys: {
    p256dh: 'test-p256dh-key',
    auth: 'test-auth-key',
  },
};

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should subscribe an authenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: { id: 'sub-1' }, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: mockUser as never, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({ id: 'sub-1' });
  });

  it('should subscribe a guest with participantId', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: { id: 'sub-2' }, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, participantId: '00000000-0000-0000-0000-000000000001' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({ id: 'sub-2' });
  });

  it('should return 401 when no auth and no participantId', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain('Authentication required');
  });

  it('should return 400 on invalid endpoint URL', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: mockUser as never, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'not-a-url',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('should return 400 on missing keys', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: mockUser as never, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/test',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('should return 400 on RPC error', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC failed' } }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: mockUser as never, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('RPC failed');
  });

  it('should handle malformed JSON body', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ user: mockUser as never, error: null });

    const request = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });
});
