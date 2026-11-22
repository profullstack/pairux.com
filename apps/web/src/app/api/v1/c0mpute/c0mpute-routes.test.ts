import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMemoryDb } from '@/test/mocks/memory-db';
import {
  PENDING_COOKIE,
  beginConnect,
  defaultEndpoints,
  encodePending,
  redirectUri,
} from '@/lib/c0mpute-live';

type Row = Record<string, unknown>;

let db: ReturnType<typeof createMemoryDb>;
let currentUser: { id: string } | null;

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => db,
}));
vi.mock('@/lib/supabase/server', () => ({
  // The user's client: same tables, RPCs acting as `currentUser`.
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: currentUser } }) },
      rpc: (name: string, args: Row) => db.rpc(name, args),
    }),
}));

const { GET: start } = await import('./oauth/start/route');
const { GET: callback } = await import('./oauth/callback/route');
const { POST: connectKey } = await import('./key/route');
const { GET: status } = await import('./status/route');
const { POST: disconnect } = await import('./disconnect/route');

const USER = 'user-1';
const STATE_SECRET = 'state-secret-for-route-tests';
// Fixtures, assembled so no key-shaped literal sits in the source.
const KEY = `c0k_${'k'.repeat(24)}`;
const TOKEN = `c0k_${'t'.repeat(24)}`;
const cfg = {
  origin: 'https://c0mpute.com',
  siteUrl: 'https://pairux.com',
  stateSecret: STATE_SECRET,
};

/** The stream key the c0mpute double hands out for a stream name. */
const streamKeyFor = (name: string) => `c0l_key_${name}`;

const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

interface C0Opts {
  unauthorized?: boolean;
  tokenError?: string;
}
let c0: C0Opts;
let fetchCalls: { method: string; path: string; auth: string | null; body: string }[];

/** c0mpute.com: OAuth register/token and the Live API. */
function c0mputeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  );
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? init.body : '';
  const auth = new Headers(init?.headers).get('authorization');
  fetchCalls.push({ method, path: url.pathname, auth, body });
  if (url.origin !== 'https://c0mpute.com') return Promise.resolve(json(500, {}));
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return Promise.resolve(json(404, {}));
  }
  if (url.pathname === '/api/oauth/register') {
    return Promise.resolve(json(201, { client_id: 'cid_registered' }));
  }
  if (url.pathname === '/api/oauth/token') {
    return Promise.resolve(
      c0.tokenError ? json(401, { error: c0.tokenError }) : json(200, { access_token: TOKEN })
    );
  }
  if (c0.unauthorized || (auth !== `Bearer ${KEY}` && auth !== `Bearer ${TOKEN}`)) {
    return Promise.resolve(json(401, { error: { code: 'unauthorized', message: 'no' } }));
  }
  if (url.pathname === '/api/v1/live/me') {
    return Promise.resolve(
      json(200, {
        account: { id: 'acct_1', label: 'anthony@c0mpute' },
        balance_usd: 3.5,
        tier: 'paid',
        usd_per_gb: 0.02,
        free_tier: { max_height: 720, max_viewers: 25 },
        top_up: 'https://c0mpute.com/dashboard/live',
      })
    );
  }
  if (url.pathname === '/api/v1/live/streams' && method === 'POST') {
    const { name } = JSON.parse(body) as { name: string };
    return Promise.resolve(
      json(201, {
        id: `lv_${name}`,
        name,
        watch_url: `https://c0mpute.com/live/${name}`,
        playback_url: `https://live.c0mpute.com/hls/${name}.m3u8`,
        rtmp_url: 'rtmp://live.c0mpute.com/live',
        stream_key: streamKeyFor(name),
      })
    );
  }
  return Promise.resolve(json(404, { error: { code: 'not_found', message: 'no' } }));
}

/** The channel RPCs, with the same ownership rule the database enforces. */
function seed(tables: Record<string, Row[]> = {}) {
  db = createMemoryDb({
    channels: [
      { id: 'ch-1', handle: 'anthony', name: 'Anthony Live', owner: USER, restream_enabled: false },
      { id: 'ch-2', handle: 'studio', name: 'Studio', owner: USER, restream_enabled: false },
      {
        id: 'ch-x',
        handle: 'other',
        name: 'Not Mine',
        owner: 'someone-else',
        restream_enabled: false,
      },
    ],
    channel_restream_destinations: [],
    c0mpute_live_links: [],
    c0mpute_oauth_client: [],
    ...tables,
  });
  const t = db.tables;
  const mine = (channelId: unknown) =>
    (t.channels ?? []).some((c) => c.id === channelId && c.owner === currentUser?.id);
  const denied = { data: null, error: { message: 'Not your channel' } };

  db.onRpc('list_my_channels', () => ({
    data: (t.channels ?? [])
      .filter((c) => c.owner === currentUser?.id)
      .map((c) => ({ ...c, can_manage: true })),
    error: null,
  }));
  db.onRpc('list_channel_restream_destinations', (args) => {
    if (!mine(args.p_channel_id)) return denied;
    return {
      data: (t.channel_restream_destinations ?? [])
        .filter((d) => d.channel_id === args.p_channel_id)
        .map((d) => ({ id: d.id, platform: d.platform, enabled: d.enabled })),
      error: null,
    };
  });
  db.onRpc('upsert_channel_restream_destination', (args) => {
    if (!mine(args.p_channel_id)) return denied;
    const rows = t.channel_restream_destinations ?? [];
    const existing = rows.find((d) => d.id === args.p_id);
    const next = {
      channel_id: args.p_channel_id,
      platform: args.p_platform,
      label: args.p_label,
      rtmp_url: args.p_rtmp_url,
      stream_key: args.p_stream_key,
      enabled: args.p_enabled,
    };
    if (existing) Object.assign(existing, next);
    else rows.push({ id: `dest-${String(rows.length + 1)}`, ...next });
    return { data: existing?.id ?? `dest-${String(rows.length)}`, error: null };
  });
  db.onRpc('set_channel_restream_enabled', (args) => {
    if (!mine(args.p_channel_id)) return denied;
    const ch = (t.channels ?? []).find((c) => c.id === args.p_channel_id);
    if (ch) ch.restream_enabled = args.p_enabled;
    return { data: null, error: null };
  });
}

const dests = () => db.tables.channel_restream_destinations ?? [];
const links = () => db.tables.c0mpute_live_links ?? [];
const channel = (id: string) => (db.tables.channels ?? []).find((c) => c.id === id);

function keyRequest(body: unknown) {
  return new Request('https://pairux.com/api/v1/c0mpute/key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callbackRequest(query: string, cookie?: string) {
  return new NextRequest(`https://pairux.com/api/v1/c0mpute/oauth/callback?${query}`, {
    headers: cookie ? { cookie: `${PENDING_COOKIE}=${cookie}` } : {},
  });
}

function pendingFor(userId: string, extra: { retried?: boolean } = {}) {
  const { pending } = beginConnect(cfg, defaultEndpoints(cfg.origin), {
    clientId: 'cid_registered',
    userId,
    ...extra,
  });
  return { pending, cookie: encodePending(pending, STATE_SECRET) };
}

const location = (res: Response) => res.headers.get('location') ?? '';

beforeEach(() => {
  currentUser = { id: USER };
  c0 = {};
  fetchCalls = [];
  seed();
  vi.stubEnv('C0MPUTE_LIVE_STATE_SECRET', STATE_SECRET);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pairux.com');
  vi.stubEnv('C0MPUTE_ORIGIN', '');
  vi.stubGlobal('fetch', c0mputeFetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/v1/c0mpute/key', () => {
  it('needs a session', async () => {
    currentUser = null;
    const res = await connectKey(keyRequest({ key: KEY }));
    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
  });

  it('rejects something that is not a c0mpute key without calling c0mpute', async () => {
    for (const key of ['', 'hunter2', 'c0l_streamkeynotapikey', 42, null]) {
      const res = await connectKey(keyRequest({ key }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('format');
    }
    expect(fetchCalls).toHaveLength(0);
    expect(dests()).toHaveLength(0);
  });

  it('provisions every channel the user manages and keeps the key out of everything', async () => {
    const res = await connectKey(keyRequest({ key: `  ${KEY}  ` }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      data: { outcome: string; tier: string; accountLabel: string; channels: Row[] };
    };
    expect(body.data.outcome).toBe('connected');
    expect(body.data.tier).toBe('paid');
    expect(body.data.accountLabel).toBe('anthony@c0mpute');
    expect(body.data.channels.map((c) => c.channelId)).toEqual(['ch-1', 'ch-2']);

    expect(dests()).toEqual([
      {
        id: 'dest-1',
        channel_id: 'ch-1',
        platform: 'c0mpute',
        label: 'c0mpute Live',
        rtmp_url: 'rtmp://live.c0mpute.com/live',
        stream_key: streamKeyFor('anthony'),
        enabled: true,
      },
      {
        id: 'dest-2',
        channel_id: 'ch-2',
        platform: 'c0mpute',
        label: 'c0mpute Live',
        rtmp_url: 'rtmp://live.c0mpute.com/live',
        stream_key: streamKeyFor('studio'),
        enabled: true,
      },
    ]);
    expect(links().map((l) => [l.channel_id, l.user_id, l.stream_id, l.watch_url])).toEqual([
      ['ch-1', USER, 'lv_anthony', 'https://c0mpute.com/live/anthony'],
      ['ch-2', USER, 'lv_studio', 'https://c0mpute.com/live/studio'],
    ]);
    // Nothing else to restream to, so the channel's master switch came on.
    expect(channel('ch-1')?.restream_enabled).toBe(true);
    // Someone else's channel was never touched.
    expect(dests().some((d) => d.channel_id === 'ch-x')).toBe(false);

    // The pasted key is in no table and not in the response; stream keys are
    // only in the destinations table.
    const stored = JSON.stringify(db.tables);
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain('c0k_');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('c0l_');
    expect(JSON.stringify(links())).not.toContain('c0l_');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('does not flip the master switch on when another destination would start too', async () => {
    seed({
      channel_restream_destinations: [
        {
          id: 'yt-1',
          channel_id: 'ch-1',
          platform: 'youtube',
          rtmp_url: 'rtmp://a.rtmp.youtube.com/live2',
          stream_key: 'yt-key',
          enabled: true,
        },
      ],
    });
    const res = await connectKey(keyRequest({ key: KEY }));
    expect(res.status).toBe(200);
    expect(channel('ch-1')?.restream_enabled).toBe(false);
    expect(channel('ch-2')?.restream_enabled).toBe(true);
    // The YouTube destination is untouched and a c0mpute one sits beside it.
    expect(dests().find((d) => d.id === 'yt-1')?.stream_key).toBe('yt-key');
    expect(
      dests()
        .filter((d) => d.channel_id === 'ch-1')
        .map((d) => d.platform)
    ).toEqual(['youtube', 'c0mpute']);
  });

  it('connecting again re-keys the same destination instead of adding a second one', async () => {
    await connectKey(keyRequest({ key: KEY }));
    await connectKey(keyRequest({ key: KEY }));
    expect(dests().filter((d) => d.platform === 'c0mpute')).toHaveLength(2);
    expect(links()).toHaveLength(2);
  });

  it('a key c0mpute refuses writes nothing and says why', async () => {
    c0.unauthorized = true;
    const res = await connectKey(keyRequest({ key: KEY }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect((JSON.parse(text) as { code: string }).code).toBe('scope');
    expect(text).not.toContain(KEY);
    expect(dests()).toHaveLength(0);
    expect(links()).toHaveLength(0);
  });
});

describe('GET /api/v1/c0mpute/status', () => {
  it('is not connected before anything is set up', async () => {
    const res = await status();
    const body = (await res.json()) as { data: { connected: boolean; channels: unknown[] } };
    expect(body.data.connected).toBe(false);
    expect(body.data.channels).toEqual([]);
  });

  it('lists each channel with its watch link and never a key', async () => {
    await connectKey(keyRequest({ key: KEY }));
    const res = await status();
    const text = await res.text();
    const body = JSON.parse(text) as {
      data: { connected: boolean; accountLabel: string; channels: Row[] };
    };
    expect(body.data.connected).toBe(true);
    expect(body.data.accountLabel).toBe('anthony@c0mpute');
    expect(body.data.channels).toEqual([
      {
        channelId: 'ch-1',
        handle: 'anthony',
        name: 'Anthony Live',
        watchUrl: 'https://c0mpute.com/live/anthony',
        playbackUrl: 'https://live.c0mpute.com/hls/anthony.m3u8',
        restreamEnabled: true,
      },
      {
        channelId: 'ch-2',
        handle: 'studio',
        name: 'Studio',
        watchUrl: 'https://c0mpute.com/live/studio',
        playbackUrl: 'https://live.c0mpute.com/hls/studio.m3u8',
        restreamEnabled: true,
      },
    ]);
    expect(text).not.toContain('c0l_');
    expect(text).not.toContain('c0k_');
  });

  it('drops a link whose destination was removed from the dashboard', async () => {
    await connectKey(keyRequest({ key: KEY }));
    const rows = dests();
    rows.splice(
      rows.findIndex((d) => d.channel_id === 'ch-1'),
      1
    );
    const res = await status();
    const body = (await res.json()) as { data: { channels: { channelId: string }[] } };
    expect(body.data.channels.map((c) => c.channelId)).toEqual(['ch-2']);
    expect(links().map((l) => l.channel_id)).toEqual(['ch-2']);
  });

  it('needs a session', async () => {
    currentUser = null;
    expect((await status()).status).toBe(401);
  });
});

describe('POST /api/v1/c0mpute/disconnect', () => {
  it('removes the c0mpute destinations and links, and nothing else', async () => {
    seed({
      channel_restream_destinations: [
        {
          id: 'yt-1',
          channel_id: 'ch-1',
          platform: 'youtube',
          rtmp_url: 'rtmp://a.rtmp.youtube.com/live2',
          stream_key: 'yt-key',
          enabled: true,
        },
        {
          id: 'theirs',
          channel_id: 'ch-x',
          platform: 'c0mpute',
          rtmp_url: 'rtmp://live.c0mpute.com/live',
          stream_key: 'c0l_theirs',
          enabled: true,
        },
      ],
      c0mpute_live_links: [
        { channel_id: 'ch-x', user_id: 'someone-else', stream_id: 'lv_theirs', created_at: 'a' },
      ],
    });
    await connectKey(keyRequest({ key: KEY }));
    expect(dests()).toHaveLength(4);

    const res = await disconnect();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { removed: number } }).data.removed).toBe(2);
    expect(dests().map((d) => d.id)).toEqual(['yt-1', 'theirs']);
    expect(links().map((l) => l.channel_id)).toEqual(['ch-x']);
    expect(
      ((await (await status()).json()) as { data: { connected: boolean } }).data.connected
    ).toBe(false);
  });

  it('needs a session', async () => {
    currentUser = null;
    expect((await disconnect()).status).toBe(401);
  });
});

describe('GET /api/v1/c0mpute/oauth/start', () => {
  it('sends a signed-out visitor to login', async () => {
    currentUser = null;
    const res = await start(new NextRequest('https://pairux.com/api/v1/c0mpute/oauth/start'));
    expect(location(res)).toBe('https://pairux.com/login?redirect=/settings');
    expect(fetchCalls.some((c) => c.path === '/api/oauth/register')).toBe(false);
  });

  it('registers the client once, then redirects to c0mpute with a sealed pending cookie', async () => {
    const res = await start(new NextRequest('https://pairux.com/api/v1/c0mpute/oauth/start'));
    const to = new URL(location(res));
    expect(to.origin + to.pathname).toBe('https://c0mpute.com/oauth/authorize');
    expect(to.searchParams.get('client_id')).toBe('cid_registered');
    expect(to.searchParams.get('scope')).toBe('live:publish');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('redirect_uri')).toBe(redirectUri(cfg));
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${PENDING_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie).toContain('Path=/api/v1/c0mpute/oauth');
    expect(db.tables.c0mpute_oauth_client).toEqual([
      { id: true, client_id: 'cid_registered', redirect_uri: redirectUri(cfg) },
    ]);

    await start(new NextRequest('https://pairux.com/api/v1/c0mpute/oauth/start'));
    expect(fetchCalls.filter((c) => c.path === '/api/oauth/register')).toHaveLength(1);
  });
});

describe('GET /api/v1/c0mpute/oauth/callback', () => {
  it('refuses a callback with no pending cookie or a forged one', async () => {
    const none = await callback(callbackRequest('code=abc&state=xyz'));
    expect(location(none)).toBe('https://pairux.com/settings?c0mpute=expired#c0mpute');

    const { cookie, pending } = pendingFor(USER);
    const forged = await callback(callbackRequest(`code=abc&state=${pending.state}`, `x${cookie}`));
    expect(location(forged)).toBe('https://pairux.com/settings?c0mpute=expired#c0mpute');
    expect(fetchCalls.some((c) => c.path === '/api/oauth/token')).toBe(false);
  });

  it('refuses a state that does not match', async () => {
    const { cookie } = pendingFor(USER);
    const res = await callback(callbackRequest('code=abc&state=not-the-state', cookie));
    expect(location(res)).toBe('https://pairux.com/settings?c0mpute=state#c0mpute');
    expect(fetchCalls.some((c) => c.path === '/api/oauth/token')).toBe(false);
    expect(dests()).toHaveLength(0);
  });

  it('refuses when the session is not the one that started', async () => {
    const { cookie, pending } = pendingFor('another-user');
    const res = await callback(callbackRequest(`code=abc&state=${pending.state}`, cookie));
    expect(location(res)).toBe('https://pairux.com/settings?c0mpute=session#c0mpute');
    expect(fetchCalls.some((c) => c.path === '/api/oauth/token')).toBe(false);
  });

  it('reports a denied authorization', async () => {
    const { cookie, pending } = pendingFor(USER);
    const res = await callback(
      callbackRequest(`error=access_denied&state=${pending.state}`, cookie)
    );
    expect(location(res)).toBe('https://pairux.com/settings?c0mpute=denied#c0mpute');
  });

  it('exchanges the code, provisions, and stores no token', async () => {
    const { cookie, pending } = pendingFor(USER);
    const res = await callback(callbackRequest(`code=the-code&state=${pending.state}`, cookie));
    expect(location(res)).toBe('https://pairux.com/settings?c0mpute=connected&tier=paid#c0mpute');

    const exchange = fetchCalls.find((c) => c.path === '/api/oauth/token');
    const form = new URLSearchParams(exchange?.body);
    expect(form.get('code')).toBe('the-code');
    expect(form.get('code_verifier')).toBe(pending.verifier);
    expect(form.get('client_id')).toBe('cid_registered');

    expect(dests().map((d) => [d.channel_id, d.platform, d.stream_key])).toEqual([
      ['ch-1', 'c0mpute', streamKeyFor('anthony')],
      ['ch-2', 'c0mpute', streamKeyFor('studio')],
    ]);
    expect(links()).toHaveLength(2);
    const stored = JSON.stringify(db.tables);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('c0k_');
    // Not in the redirect or any cookie either; the pending cookie is cleared.
    expect(location(res)).not.toContain('c0k_');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('c0k_');
    expect(setCookie).toContain(`${PENDING_COOKIE}=;`);
  });

  it('forgets a client id c0mpute no longer knows and starts over once', async () => {
    db.tables.c0mpute_oauth_client = [
      { id: true, client_id: 'cid_registered', redirect_uri: redirectUri(cfg) },
    ];
    c0.tokenError = 'invalid_client';

    const first = pendingFor(USER);
    const res = await callback(
      callbackRequest(`code=the-code&state=${first.pending.state}`, first.cookie)
    );
    expect(location(res)).toBe('https://pairux.com/api/v1/c0mpute/oauth/start?retry=1');
    expect(db.tables.c0mpute_oauth_client).toEqual([]);

    // The retried attempt does not loop.
    const second = pendingFor(USER, { retried: true });
    const again = await callback(
      callbackRequest(`code=the-code&state=${second.pending.state}`, second.cookie)
    );
    expect(location(again)).toBe('https://pairux.com/settings?c0mpute=failed#c0mpute');
    expect(dests()).toHaveLength(0);
  });

  it('any other exchange failure is a plain failure', async () => {
    c0.tokenError = 'invalid_grant';
    const { cookie, pending } = pendingFor(USER);
    const res = await callback(callbackRequest(`code=the-code&state=${pending.state}`, cookie));
    expect(location(res)).toBe('https://pairux.com/settings?c0mpute=failed#c0mpute');
    expect(dests()).toHaveLength(0);
  });
});
