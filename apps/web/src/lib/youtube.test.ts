import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildAuthUrl,
  findTransitionableBroadcasts,
  transitionToLive,
  exchangeCodeForTokens,
  youtubeOAuthConfigured,
} from './youtube';

describe('youtube lib', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://pairux.com';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('youtubeOAuthConfigured reflects env presence', () => {
    expect(youtubeOAuthConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_ID;
    expect(youtubeOAuthConfigured()).toBe(false);
  });

  it('buildAuthUrl requests offline access + consent with scope, state and redirect', () => {
    const url = new URL(buildAuthUrl('xyz'));
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('scope')).toContain('youtube');
    expect(url.searchParams.get('redirect_uri')).toBe('https://pairux.com/api/youtube/callback');
  });

  it('findTransitionableBroadcasts returns only ready/testing broadcasts', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            { id: 'a', status: { lifeCycleStatus: 'ready' }, snippet: { title: 'A' } },
            { id: 'b', status: { lifeCycleStatus: 'live' }, snippet: { title: 'B' } },
            { id: 'c', status: { lifeCycleStatus: 'testing' }, snippet: { title: 'C' } },
            { id: 'd', status: { lifeCycleStatus: 'complete' }, snippet: { title: 'D' } },
          ],
        }),
    }) as unknown as typeof fetch;

    const res = await findTransitionableBroadcasts('tok');
    expect(res.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('transitionToLive POSTs to the transition endpoint with broadcastStatus=live', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    global.fetch = fetchMock as unknown as typeof fetch;

    await transitionToLive('tok', 'bid-1');

    const [calledUrl, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/liveBroadcasts/transition');
    expect(calledUrl).toContain('broadcastStatus=live');
    expect(calledUrl).toContain('id=bid-1');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('exchangeCodeForTokens returns the parsed token response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    }) as unknown as typeof fetch;

    const t = await exchangeCodeForTokens('code');
    expect(t.refresh_token).toBe('rt');
    expect(t.access_token).toBe('at');
  });
});
