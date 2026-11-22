import { describe, expect, it, vi } from 'vitest';
import {
  C0MPUTE_RTMP_URL,
  C0mputeError,
  beginConnect,
  connectWithCredential,
  decodePending,
  defaultEndpoints,
  discoverEndpoints,
  encodePending,
  ensureClientId,
  exchangeCode,
  liveApi,
  looksLikeApiKey,
  outcomeCode,
  pkceChallenge,
  provision,
  redirectUri,
  sameState,
  streamNameFor,
  type C0mputeLiveStore,
  type ChannelRef,
  type ClientCache,
  type LiveLink,
} from './c0mpute-live';

const cfg = {
  origin: 'https://c0mpute.com',
  siteUrl: 'https://pairux.com',
  stateSecret: 'state-secret-for-tests',
};
const endpoints = defaultEndpoints(cfg.origin);
// A fixture, assembled so no key-shaped literal sits in the source.
const TOKEN = `c0k_${'t'.repeat(24)}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: string;
}

/** A fetch that records every call and answers from `route`. */
function fakeFetch(route: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    return Promise.resolve(route(call));
  }) as typeof fetch;
  return { impl, calls };
}

function memCache(initial: { id: string; redirectUri: string } | null = null) {
  let row = initial;
  const cache: ClientCache = {
    getClient: async (uri) => (row?.redirectUri === uri ? row.id : null),
    saveClient: async (uri, id) => {
      row = { id, redirectUri: uri };
    },
    clearClient: async () => {
      row = null;
    },
  };
  return { cache, get: () => row };
}

interface Dest {
  rtmpUrl: string;
  streamKey: string;
  label: string;
}

function memStore(channels: ChannelRef[], opts: { failUpsertFor?: string } = {}) {
  const destinations = new Map<string, Dest>();
  const links = new Map<string, LiveLink>();
  const enabled: string[] = [];
  const store: C0mputeLiveStore = {
    manageableChannels: async () => channels,
    upsertDestination: async (channelId, dest) => {
      if (channelId === opts.failUpsertFor) throw new Error('Not your channel');
      destinations.set(channelId, dest);
    },
    enableRestreamIfSafe: async (channelId) => {
      enabled.push(channelId);
    },
    saveLink: async (link) => {
      links.set(link.channel_id, link);
    },
  };
  return { store, destinations, links, enabled };
}

const CH1: ChannelRef = { id: 'ch-1', handle: 'anthony', name: 'Anthony Live' };
const CH2: ChannelRef = { id: 'ch-2', handle: 'Team_Show', name: 'Team Show' };

/** A c0mpute Live API double: `taken` names answer 409 on create. */
function c0mputeApi(opts: { taken?: string[]; status401?: boolean } = {}) {
  const taken = new Set(opts.taken ?? []);
  let n = 0;
  return fakeFetch((call) => {
    const path = new URL(call.url).pathname;
    if (opts.status401) return json(401, { error: { code: 'unauthorized', message: 'bad token' } });
    if (call.method === 'GET' && path === '/api/v1/live/me') {
      return json(200, {
        account: { id: 'acct_1', label: 'anthony@c0mpute' },
        balance_usd: 0,
        tier: 'free',
        usd_per_gb: 0.02,
        free_tier: { max_height: 720, max_viewers: 25 },
        rtmp_url: C0MPUTE_RTMP_URL,
        top_up: 'https://c0mpute.com/dashboard/live',
      });
    }
    if (call.method === 'POST' && path === '/api/v1/live/streams') {
      const body = JSON.parse(call.body) as { name: string; title: string };
      if (taken.has(body.name)) {
        return json(409, { error: { code: 'conflict', message: 'name taken' } });
      }
      n += 1;
      return json(201, {
        id: `lv_new${String(n)}`,
        name: body.name,
        title: body.title,
        visibility: 'public',
        live: false,
        tier: 'free',
        watch_url: `https://c0mpute.com/live/${body.name}`,
        playback_url: `https://live.c0mpute.com/hls/${body.name}.m3u8`,
        rtmp_url: C0MPUTE_RTMP_URL,
        stream_key: `c0l_created_${body.name}`,
        publish_url: `${C0MPUTE_RTMP_URL}/c0l_created_${body.name}`,
      });
    }
    if (call.method === 'GET' && path === '/api/v1/live/streams') {
      return json(200, {
        streams: [...taken].map((name) => ({
          id: `lv_old_${name}`,
          name,
          watch_url: `https://c0mpute.com/live/${name}`,
          playback_url: `https://live.c0mpute.com/hls/${name}.m3u8`,
        })),
      });
    }
    const rekey = /^\/api\/v1\/live\/streams\/([^/]+)\/key$/.exec(path);
    if (call.method === 'POST' && rekey) {
      return json(200, {
        stream_key: `c0l_rekeyed_${rekey[1] ?? ''}`,
        publish_url: `${C0MPUTE_RTMP_URL}/c0l_rekeyed`,
      });
    }
    return json(404, { error: { code: 'not_found', message: 'nope' } });
  });
}

describe('c0mpute Live OAuth', () => {
  it('authorize URL carries PKCE S256, state, the live:publish scope and the exact redirect', () => {
    const { pending, url } = beginConnect(cfg, endpoints, { clientId: 'cid_1', userId: 'u1' });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://c0mpute.com/oauth/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('cid_1');
    expect(u.searchParams.get('scope')).toBe('live:publish');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://pairux.com/api/v1/c0mpute/oauth/callback'
    );
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(pkceChallenge(pending.verifier));
    expect(u.searchParams.get('state')).toBe(pending.state);
    // The verifier itself never goes to the browser's address bar.
    expect(url).not.toContain(pending.verifier);
    expect(pending.retried).toBe(false);
  });

  it('PKCE challenge is the RFC 7636 S256 transform', () => {
    // RFC 7636 appendix B.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('pending cookie round-trips and rejects tampering, a wrong key and expiry', () => {
    const { pending } = beginConnect(cfg, endpoints, { clientId: 'cid_1', userId: 'u1' });
    const sealed = encodePending(pending, cfg.stateSecret);
    expect(decodePending(sealed, cfg.stateSecret)).toEqual(pending);

    // Swap the user id inside the body, keep the old signature.
    const [body = '', sig = ''] = sealed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...pending, userId: 'attacker', state: 'chosen' })
    ).toString('base64url');
    expect(decodePending(`${forged}.${sig}`, cfg.stateSecret)).toBeNull();
    // Flip one signature character.
    const flipped = sig.startsWith('A') ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(decodePending(`${body}.${flipped}`, cfg.stateSecret)).toBeNull();
    expect(decodePending(sealed, 'another-secret')).toBeNull();
    expect(decodePending(body, cfg.stateSecret)).toBeNull();
    expect(decodePending('', cfg.stateSecret)).toBeNull();
    expect(decodePending(null, cfg.stateSecret)).toBeNull();

    const expired = encodePending({ ...pending, exp: 1 }, cfg.stateSecret);
    expect(decodePending(expired, cfg.stateSecret)).toBeNull();
  });

  it('state must match exactly', () => {
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', 'abcd')).toBe(false);
    expect(sameState('abc', null)).toBe(false);
  });

  it('registers a public client once and reuses the cached id', async () => {
    const { cache, get } = memCache();
    const { impl, calls } = fakeFetch(() => json(201, { client_id: 'cid_new' }));
    expect(await ensureClientId(cfg, cache, endpoints, impl)).toBe('cid_new');
    expect(await ensureClientId(cfg, cache, endpoints, impl)).toBe('cid_new');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://c0mpute.com/api/oauth/register');
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(sent.token_endpoint_auth_method).toBe('none');
    expect(sent.redirect_uris).toEqual([redirectUri(cfg)]);
    expect(sent.grant_types).toEqual(['authorization_code']);
    expect(sent.scope).toBe('live:publish');
    expect(get()).toEqual({ id: 'cid_new', redirectUri: redirectUri(cfg) });
  });

  it('registers again when the cached id was for another redirect or was cleared', async () => {
    const { cache } = memCache({ id: 'cid_old', redirectUri: 'https://staging.example/cb' });
    const { impl, calls } = fakeFetch(() => json(201, { client_id: 'cid_fresh' }));
    expect(await ensureClientId(cfg, cache, endpoints, impl)).toBe('cid_fresh');
    await cache.clearClient();
    expect(await ensureClientId(cfg, cache, endpoints, impl)).toBe('cid_fresh');
    expect(calls).toHaveLength(2);
  });

  it('a refused registration throws and caches nothing', async () => {
    const { cache, get } = memCache();
    const { impl } = fakeFetch(() => json(400, { error: 'invalid_redirect_uri' }));
    await expect(ensureClientId(cfg, cache, endpoints, impl)).rejects.toMatchObject({
      code: 'invalid_redirect_uri',
    });
    expect(get()).toBeNull();
  });

  it('discovery only trusts https endpoints on the c0mpute origin', async () => {
    const good = fakeFetch(() =>
      json(200, {
        authorization_endpoint: 'https://c0mpute.com/oauth/authorize2',
        token_endpoint: 'https://evil.example/token',
        registration_endpoint: 'http://c0mpute.com/api/oauth/register',
      })
    );
    expect(await discoverEndpoints(cfg, good.impl)).toEqual({
      authorize: 'https://c0mpute.com/oauth/authorize2',
      token: endpoints.token,
      register: endpoints.register,
    });
    expect(good.calls[0]?.url).toBe('https://c0mpute.com/.well-known/oauth-authorization-server');

    const down = fakeFetch(() => json(503, {}));
    expect(await discoverEndpoints(cfg, down.impl)).toEqual(endpoints);
    const broken = (() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    expect(await discoverEndpoints(cfg, broken)).toEqual(endpoints);
  });

  it('code exchange sends the verifier and client id, with no client secret', async () => {
    const { impl, calls } = fakeFetch(() =>
      json(200, { access_token: TOKEN, scope: 'live:publish' })
    );
    const token = await exchangeCode(
      cfg,
      endpoints,
      { code: 'the-code', verifier: 'the-verifier', clientId: 'cid_1' },
      impl
    );
    expect(token).toBe(TOKEN);
    expect(calls[0]?.url).toBe('https://c0mpute.com/api/oauth/token');
    const form = new URLSearchParams(calls[0]?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('code_verifier')).toBe('the-verifier');
    expect(form.get('client_id')).toBe('cid_1');
    expect(form.get('redirect_uri')).toBe(redirectUri(cfg));
    expect(form.has('client_secret')).toBe(false);
    expect(calls[0]?.auth).toBeNull();
  });

  it('a failed exchange throws with the server code and never a token', async () => {
    const gone = fakeFetch(() => json(401, { error: 'invalid_client' }));
    await expect(
      exchangeCode(cfg, endpoints, { code: 'c', verifier: 'v', clientId: 'cid_gone' }, gone.impl)
    ).rejects.toMatchObject({ code: 'invalid_client', status: 401 });

    const bad = fakeFetch(() => json(400, { error: 'invalid_grant', access_token: TOKEN }));
    const err = await exchangeCode(
      cfg,
      endpoints,
      { code: 'c', verifier: 'v', clientId: 'cid_1' },
      bad.impl
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(C0mputeError);
    expect((err as C0mputeError).code).toBe('invalid_grant');
    expect((err as C0mputeError).message).not.toContain(TOKEN);

    const empty = fakeFetch(() => json(200, {}));
    await expect(
      exchangeCode(cfg, endpoints, { code: 'c', verifier: 'v', clientId: 'cid_1' }, empty.impl)
    ).rejects.toMatchObject({ code: 'token_exchange_failed' });
  });
});

describe('c0mpute Live provisioning', () => {
  it('creates one stream per channel and saves it as an enabled c0mpute destination', async () => {
    const { store, destinations, links, enabled } = memStore([CH1, CH2]);
    const c0 = c0mputeApi();
    const { account, result } = await connectWithCredential(cfg, TOKEN, 'user-1', store, c0.impl);

    expect(account.accountLabel).toBe('anthony@c0mpute');
    expect(account.tier).toBe('free');
    expect(account.freeTier).toEqual({ maxHeight: 720, maxViewers: 25 });
    expect(result.channels.map((c) => c.ok)).toEqual([true, true]);
    expect(outcomeCode(result)).toBe('connected');

    expect(destinations.get('ch-1')).toEqual({
      rtmpUrl: 'rtmp://live.c0mpute.com/live',
      streamKey: 'c0l_created_anthony',
      label: 'c0mpute Live',
    });
    expect(destinations.get('ch-2')?.streamKey).toBe('c0l_created_team-show');
    expect(links.get('ch-1')).toEqual({
      channel_id: 'ch-1',
      user_id: 'user-1',
      stream_id: 'lv_new1',
      watch_url: 'https://c0mpute.com/live/anthony',
      playback_url: 'https://live.c0mpute.com/hls/anthony.m3u8',
      account_label: 'anthony@c0mpute',
    });
    expect(enabled).toEqual(['ch-1', 'ch-2']);

    const creates = c0.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/streams'));
    expect(creates.map((c) => JSON.parse(c.body) as unknown)).toEqual([
      { name: 'anthony', title: 'Anthony Live', visibility: 'public' },
      { name: 'team-show', title: 'Team Show', visibility: 'public' },
    ]);
    // Every API call is authorized with the credential, as a Bearer token.
    expect(c0.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('on 409 finds the existing stream by name and fetches a fresh key', async () => {
    const { store, destinations, links } = memStore([CH1, CH2]);
    const c0 = c0mputeApi({ taken: ['anthony'] });
    const { result } = await connectWithCredential(cfg, TOKEN, 'user-1', store, c0.impl);

    expect(result.channels.map((c) => c.ok)).toEqual([true, true]);
    expect(destinations.get('ch-1')?.streamKey).toBe('c0l_rekeyed_lv_old_anthony');
    expect(links.get('ch-1')?.stream_id).toBe('lv_old_anthony');
    expect(links.get('ch-1')?.watch_url).toBe('https://c0mpute.com/live/anthony');
    // The other channel was created normally.
    expect(destinations.get('ch-2')?.streamKey).toBe('c0l_created_team-show');
    expect(c0.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/v1/live/me',
      'POST /api/v1/live/streams',
      'GET /api/v1/live/streams',
      'POST /api/v1/live/streams/lv_old_anthony/key',
      'POST /api/v1/live/streams',
    ]);
  });

  it('a 409 with no stream of that name in the list fails only that channel', async () => {
    const { store, destinations } = memStore([CH1]);
    const { impl } = fakeFetch((call) => {
      const path = new URL(call.url).pathname;
      if (call.method === 'POST' && path.endsWith('/streams')) {
        return json(409, { error: { code: 'conflict', message: 'taken' } });
      }
      return json(200, { streams: [] });
    });
    const result = await provision(
      { userId: 'user-1', accountLabel: null },
      liveApi(cfg, TOKEN, impl),
      store
    );
    expect(result.channels).toEqual([
      {
        channelId: 'ch-1',
        handle: 'anthony',
        name: 'Anthony Live',
        ok: false,
        watchUrl: null,
        error: 'conflict',
      },
    ]);
    expect(destinations.size).toBe(0);
    expect(outcomeCode(result)).toBe('failed');
  });

  it('one channel the user may not manage does not stop the others', async () => {
    const { store, destinations, links } = memStore([CH1, CH2], { failUpsertFor: 'ch-1' });
    const c0 = c0mputeApi();
    const { result } = await connectWithCredential(cfg, TOKEN, 'user-1', store, c0.impl);
    expect(result.channels.map((c) => [c.channelId, c.ok, c.error])).toEqual([
      ['ch-1', false, 'save_failed'],
      ['ch-2', true, undefined],
    ]);
    expect(destinations.has('ch-1')).toBe(false);
    // No link without a destination.
    expect(links.has('ch-1')).toBe(false);
    expect(links.has('ch-2')).toBe(true);
    expect(outcomeCode(result)).toBe('partial');
  });

  it('a 401 stops everything: the credential is bad or lacks live:publish', async () => {
    const { store, destinations, links } = memStore([CH1, CH2]);
    const c0 = c0mputeApi({ status401: true });
    await expect(connectWithCredential(cfg, TOKEN, 'user-1', store, c0.impl)).rejects.toMatchObject(
      { code: 'unauthorized', status: 401 }
    );
    expect(destinations.size).toBe(0);
    expect(links.size).toBe(0);
  });

  it('a 401 in the middle of provisioning is not swallowed as a per-channel error', async () => {
    const { store } = memStore([CH1, CH2]);
    let creates = 0;
    const { impl } = fakeFetch((call) => {
      if (call.method === 'POST') {
        creates += 1;
        if (creates === 2) return json(401, { error: { code: 'unauthorized', message: 'x' } });
        return json(201, { id: 'lv_1', name: 'anthony', stream_key: 'c0l_k' });
      }
      return json(200, {});
    });
    await expect(
      provision({ userId: 'user-1', accountLabel: null }, liveApi(cfg, TOKEN, impl), store)
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('no channels is its own outcome', async () => {
    const { store } = memStore([]);
    const c0 = c0mputeApi();
    const { result } = await connectWithCredential(cfg, TOKEN, 'user-1', store, c0.impl);
    expect(result.channels).toEqual([]);
    expect(outcomeCode(result)).toBe('nochannels');
    // Only /live/me was called.
    expect(c0.calls).toHaveLength(1);
  });

  it('the credential is never written anywhere: not stored, returned, thrown or logged', async () => {
    const logs: unknown[][] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      })
    );
    try {
      const { store, destinations, links, enabled } = memStore([CH1, CH2], {
        failUpsertFor: 'ch-2',
      });
      const c0 = c0mputeApi({ taken: ['anthony'] });
      const out = await connectWithCredential(cfg, TOKEN, 'user-1', store, c0.impl);

      const written = JSON.stringify({
        destinations: [...destinations.entries()],
        links: [...links.entries()],
        enabled,
      });
      expect(written).not.toContain(TOKEN);
      expect(written).not.toContain('c0k_');
      // What comes back to the route (and so to the browser) has neither the
      // credential nor a stream key.
      const returned = JSON.stringify(out);
      expect(returned).not.toContain(TOKEN);
      expect(returned).not.toContain('c0l_');
      // The stream key is stored in exactly one place: the destination.
      expect(JSON.stringify([...links.entries()])).not.toContain('c0l_');
      expect(JSON.stringify(logs)).not.toContain(TOKEN);
      expect(JSON.stringify(logs)).not.toContain('c0l_');
      // The credential only ever left as an Authorization header to c0mpute.
      for (const call of c0.calls) {
        expect(new URL(call.url).origin).toBe('https://c0mpute.com');
        expect(call.url).not.toContain(TOKEN);
        expect(call.body).not.toContain(TOKEN);
      }

      // Errors do not carry it either.
      const denied = c0mputeApi({ status401: true });
      const err = await connectWithCredential(cfg, TOKEN, 'user-1', store, denied.impl).catch(
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(C0mputeError);
      expect(JSON.stringify({ m: (err as Error).message, s: (err as Error).stack })).not.toContain(
        TOKEN
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('a create response without a stream key is an error, not an empty destination', async () => {
    const { store, destinations } = memStore([CH1]);
    const { impl } = fakeFetch(() => json(201, { id: 'lv_1', name: 'anthony' }));
    const result = await provision(
      { userId: 'user-1', accountLabel: null },
      liveApi(cfg, TOKEN, impl),
      store
    );
    expect(result.channels[0]?.ok).toBe(false);
    expect(result.channels[0]?.error).toBe('bad_response');
    expect(destinations.size).toBe(0);
  });

  it('only https watch links are kept', async () => {
    const { store, links } = memStore([CH1]);
    const { impl } = fakeFetch(() =>
      json(201, {
        id: 'lv_1',
        name: 'anthony',
        stream_key: 'c0l_k',
        watch_url: 'javascript:alert(1)',
        playback_url: 'http://live.c0mpute.com/x.m3u8',
      })
    );
    await provision({ userId: 'user-1', accountLabel: null }, liveApi(cfg, TOKEN, impl), store);
    expect(links.get('ch-1')?.watch_url).toBeNull();
    expect(links.get('ch-1')?.playback_url).toBeNull();
  });

  it('stream names come from the channel handle', () => {
    expect(streamNameFor(CH1)).toBe('anthony');
    expect(streamNameFor(CH2)).toBe('team-show');
    expect(streamNameFor({ id: 'ab12-cd34-ef56-7890', handle: '***', name: 'x' })).toBe(
      'pairux-ab12cd34ef56'
    );
  });

  it('recognizes the shape of a c0mpute API key', () => {
    expect(looksLikeApiKey('c0k_abcdefgh12345678')).toBe(true);
    expect(looksLikeApiKey('c0l_abcdefgh12345678')).toBe(false);
    expect(looksLikeApiKey('c0k_')).toBe(false);
    expect(looksLikeApiKey('c0k_has spaces in it')).toBe(false);
    expect(looksLikeApiKey('')).toBe(false);
  });
});
