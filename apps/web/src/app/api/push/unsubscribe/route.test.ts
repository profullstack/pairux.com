import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/push/unsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove a push subscription', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/test' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.removed).toBe(true);
  });

  it('should return 400 on invalid endpoint URL', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'not-a-url' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('should return 400 on missing endpoint', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('should return 400 on RPC error', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Delete failed' } }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/test' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Delete failed');
  });

  it('should handle malformed JSON body', async () => {
    const mockSupabase = createMockSupabaseClient();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/push/unsubscribe', {
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
