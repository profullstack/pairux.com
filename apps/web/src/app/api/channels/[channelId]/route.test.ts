import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';

const CHANNEL_ID = '00000000-0000-0000-0000-0000000000c1';

function patch(body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/channels/${CHANNEL_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ channelId: CHANNEL_ID }) }
  );
}

function setup(rpcResult: { data: unknown; error: { message: string } | null }, authed = true) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient({ rpc }) as never);
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    user: authed ? (mockUser as never) : null,
    error: null,
  });
  return rpc;
}

describe('PATCH /api/channels/[channelId] website_url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes and saves the website for the owner', async () => {
    const rpc = setup({ data: null, error: null });
    const res = await patch({ website_url: 'cigarunderground.org' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { ok: true, website_url: 'https://cigarunderground.org' },
    });
    expect(rpc).toHaveBeenCalledWith(
      'update_channel',
      expect.objectContaining({
        p_channel_id: CHANNEL_ID,
        p_website_url: 'https://cigarunderground.org',
      })
    );
  });

  it('clears the website with an empty string', async () => {
    const rpc = setup({ data: null, error: null });
    const res = await patch({ website_url: '' });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'update_channel',
      expect.objectContaining({ p_website_url: '' })
    );
  });

  it('leaves the website unchanged when the field is omitted', async () => {
    const rpc = setup({ data: null, error: null });
    await patch({ name: 'New name' });
    expect(rpc).toHaveBeenCalledWith(
      'update_channel',
      expect.objectContaining({ p_name: 'New name', p_website_url: null })
    );
  });

  it('rejects a javascript: URL without calling the database', async () => {
    const rpc = setup({ data: null, error: null });
    const res = await patch({ website_url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Website must be an http:// or https:// link.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const rpc = setup({ data: null, error: null }, false);
    const res = await patch({ website_url: 'example.com' });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller does not own the channel', async () => {
    setup({ data: null, error: { message: 'Channel not found or not yours' } });
    const res = await patch({ website_url: 'example.com' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/only the channel owner/i);
  });
});
