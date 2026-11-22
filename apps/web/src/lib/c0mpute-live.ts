// c0mpute Live: restream a channel's lives into the c0mpute p2p network.
//
// A user connects from Settings, by c0mpute.com OAuth or by pasting a c0mpute
// API key (c0k_...). Either credential is used ONCE, inside that request, to
// create one c0mpute stream per channel and save its RTMP stream key as an
// ordinary restream destination (platform 'c0mpute'). The credential is then
// dropped: it is never written to the database, a cookie, a log or a response.
// What stays is the destination (service-role only, so auto go-live works with
// nobody signed in) and a c0mpute_live_links row with the watch link.
//
// c0mpute.com is a public-client-only authorization server: PairUX registers
// itself (dynamic registration, token_endpoint_auth_method "none"), keeps the
// client id in the database and proves possession with PKCE S256. There is no
// client secret, so the pending-authorization cookie is HMAC-sealed under a
// server secret instead.
//
// Everything here is written against the C0mputeLiveStore interface and an
// injected fetch so the tests run in memory; c0mpute-live-store.ts is the
// Supabase store.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const C0MPUTE_ORIGIN = 'https://c0mpute.com';
export const C0MPUTE_SCOPE = 'live:publish';
export const C0MPUTE_PLATFORM = 'c0mpute';
export const C0MPUTE_RTMP_URL = 'rtmp://live.c0mpute.com/live';
export const C0MPUTE_DASHBOARD_URL = 'https://c0mpute.com/dashboard/live';
export const CALLBACK_PATH = '/api/v1/c0mpute/oauth/callback';
export const PENDING_COOKIE = 'pux_c0_oauth';
export const PENDING_COOKIE_PATH = '/api/v1/c0mpute/oauth';
export const PENDING_TTL = 600;

// Read at request time through a variable key: Next inlines `process.env.NAME`
// at build time, server code included, which would bake a missing value in.
function runtimeEnv(name: string): string {
  const v = (process.env as Record<string, string | undefined>)[name];
  return typeof v === 'string' ? v.trim() : '';
}

export interface C0mputeConfig {
  /** c0mpute.com origin, no trailing slash. */
  origin: string;
  /** Canonical PairUX origin, no trailing slash. */
  siteUrl: string;
  /** Seals the pending-authorization cookie. */
  stateSecret: string;
}

/**
 * Null when there is no server secret to seal the pending cookie with. No
 * c0mpute credential is configured anywhere: the client id is registered on
 * first use.
 */
export function c0mputeConfig(): C0mputeConfig | null {
  const stateSecret =
    runtimeEnv('C0MPUTE_LIVE_STATE_SECRET') || runtimeEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!stateSecret) return null;
  const origin = (runtimeEnv('C0MPUTE_ORIGIN') || C0MPUTE_ORIGIN).replace(/\/+$/, '');
  // The redirect URI must equal the registration, so it is the canonical host,
  // never whatever Host header the request carried.
  const siteUrl = (runtimeEnv('NEXT_PUBLIC_APP_URL') || 'https://pairux.com').replace(/\/+$/, '');
  return { origin, siteUrl, stateSecret };
}

export const redirectUri = (cfg: Pick<C0mputeConfig, 'siteUrl'>) => cfg.siteUrl + CALLBACK_PATH;

/** A failure talking to c0mpute. `message` never carries a token or a stream key. */
export class C0mputeError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'C0mputeError';
    this.code = code;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

const str = (v: unknown, max = 500): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// OAuth: discovery, dynamic registration, PKCE, pending cookie, code exchange
// ---------------------------------------------------------------------------

export interface OAuthEndpoints {
  authorize: string;
  token: string;
  register: string;
}

export function defaultEndpoints(origin: string): OAuthEndpoints {
  return {
    authorize: `${origin}/oauth/authorize`,
    token: `${origin}/api/oauth/token`,
    register: `${origin}/api/oauth/register`,
  };
}

/** A discovered endpoint is used only when it is https on the c0mpute origin itself. */
function onOrigin(value: unknown, origin: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.origin === origin && u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** RFC 8414 metadata, falling back to the known paths when it cannot be read. */
export async function discoverEndpoints(
  cfg: Pick<C0mputeConfig, 'origin'>,
  fetchImpl: FetchLike = fetch
): Promise<OAuthEndpoints> {
  const fallback = defaultEndpoints(cfg.origin);
  try {
    const res = await fetchImpl(`${cfg.origin}/.well-known/oauth-authorization-server`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return fallback;
    const meta = await readJson(res);
    return {
      authorize: onOrigin(meta.authorization_endpoint, cfg.origin) ?? fallback.authorize,
      token: onOrigin(meta.token_endpoint, cfg.origin) ?? fallback.token,
      register: onOrigin(meta.registration_endpoint, cfg.origin) ?? fallback.register,
    };
  } catch {
    return fallback;
  }
}

export interface ClientCache {
  /** The cached client id registered for exactly this redirect URI, or null. */
  getClient(redirectUri: string): Promise<string | null>;
  saveClient(redirectUri: string, clientId: string): Promise<void>;
  clearClient(): Promise<void>;
}

/** Register PairUX as a public client (no secret) for the server-side callback. */
export async function registerClient(
  cfg: C0mputeConfig,
  endpoints: OAuthEndpoints,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const res = await fetchImpl(endpoints.register, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'PairUX',
      client_uri: cfg.siteUrl,
      redirect_uris: [redirectUri(cfg)],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: C0MPUTE_SCOPE,
    }),
  });
  const body = await readJson(res);
  const id = str(body.client_id, 200);
  if (!res.ok || !id) {
    throw new C0mputeError(
      str(body.error, 60) ?? 'registration_failed',
      `c0mpute client registration failed (${String(res.status)})`,
      res.status
    );
  }
  return id;
}

/** The cached client id, registering once when there is none for this redirect URI. */
export async function ensureClientId(
  cfg: C0mputeConfig,
  cache: ClientCache,
  endpoints: OAuthEndpoints,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const uri = redirectUri(cfg);
  const cached = await cache.getClient(uri);
  if (cached) return cached;
  const id = await registerClient(cfg, endpoints, fetchImpl);
  await cache.saveClient(uri, id);
  return id;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
export const randomToken = (bytes = 32) => b64url(randomBytes(bytes));
export const pkceChallenge = (verifier: string) =>
  b64url(createHash('sha256').update(verifier).digest());

export interface PendingAuth {
  state: string;
  verifier: string;
  clientId: string;
  /** The PairUX user who started; the callback must be the same session. */
  userId: string;
  /** True on the one automatic restart after c0mpute answered invalid_client. */
  retried: boolean;
  exp: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** A fresh pending authorization plus the authorize URL that starts it. */
export function beginConnect(
  cfg: C0mputeConfig,
  endpoints: OAuthEndpoints,
  input: { clientId: string; userId: string; retried?: boolean }
): { pending: PendingAuth; url: string } {
  const pending: PendingAuth = {
    state: randomToken(16),
    verifier: randomToken(48),
    clientId: input.clientId,
    userId: input.userId,
    retried: input.retried === true,
    exp: nowSec() + PENDING_TTL,
  };
  const url = new URL(endpoints.authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', pending.clientId);
  url.searchParams.set('redirect_uri', redirectUri(cfg));
  url.searchParams.set('scope', C0MPUTE_SCOPE);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('code_challenge', pkceChallenge(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { pending, url: url.toString() };
}

function mac(value: string, key: string): string {
  return createHmac('sha256', `pairux-c0mpute-pending:${key}`).update(value).digest('base64url');
}

/** HMAC-sealed under a server secret, so a browser can hold it but not forge or edit it. */
export function encodePending(p: PendingAuth, key: string): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${mac(body, key)}`;
}

export function decodePending(raw: string | null | undefined, key: string): PendingAuth | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1));
  const want = Buffer.from(mac(body, key));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<PendingAuth>;
    if (
      typeof o.state !== 'string' ||
      typeof o.verifier !== 'string' ||
      typeof o.clientId !== 'string' ||
      typeof o.userId !== 'string' ||
      !o.state ||
      !o.verifier ||
      !o.clientId ||
      !o.userId
    )
      return null;
    if (typeof o.exp !== 'number' || o.exp < nowSec()) return null;
    return {
      state: o.state,
      verifier: o.verifier,
      clientId: o.clientId,
      userId: o.userId,
      retried: o.retried === true,
      exp: o.exp,
    };
  } catch {
    return null;
  }
}

/** Constant-time compare of the state we issued with the one that came back. */
export function sameState(expected: string, got: string | null | undefined): boolean {
  if (!got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Trade the authorization code for the access token (a `c0k_` key limited to
 * live:publish). Throws C0mputeError; code "invalid_client" means the cached
 * registration is gone and the caller should register again.
 */
export async function exchangeCode(
  cfg: C0mputeConfig,
  endpoints: OAuthEndpoints,
  input: { code: string; verifier: string; clientId: string },
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const res = await fetchImpl(endpoints.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: redirectUri(cfg),
      client_id: input.clientId,
      code_verifier: input.verifier,
    }).toString(),
  });
  const body = await readJson(res);
  const token = str(body.access_token, 4096);
  if (!res.ok || !token) {
    throw new C0mputeError(
      str(body.error, 60) ?? 'token_exchange_failed',
      `c0mpute token exchange failed (${String(res.status)})`,
      res.status
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// c0mpute Live API
// ---------------------------------------------------------------------------

export type C0mputeTier = 'paid' | 'free';

export interface LiveAccount {
  accountLabel: string | null;
  tier: C0mputeTier | null;
  balanceUsd: number | null;
  usdPerGb: number | null;
  freeTier: { maxHeight: number | null; maxViewers: number | null };
  topUpUrl: string | null;
}

export interface LiveStream {
  id: string;
  name: string;
  watchUrl: string | null;
  playbackUrl: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function streamFrom(o: unknown): LiveStream | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const id = str(r.id, 200);
  const name = str(r.name, 200);
  if (!id || !name) return null;
  return { id, name, watchUrl: httpsUrl(r.watch_url), playbackUrl: httpsUrl(r.playback_url) };
}

/** Looks like a c0mpute API key. The real check is /live/me. */
export function looksLikeApiKey(key: string): boolean {
  return /^c0k_[A-Za-z0-9_-]{8,500}$/.test(key);
}

/**
 * The Live API for one credential. The credential lives only in this closure;
 * errors carry c0mpute's code and status, never the credential or a response
 * body (a create response holds a stream key).
 */
export function liveApi(
  cfg: Pick<C0mputeConfig, 'origin'>,
  credential: string,
  fetchImpl: FetchLike = fetch
) {
  const base = `${cfg.origin}/api/v1/live`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetchImpl(base + path, {
      method,
      headers: {
        authorization: `Bearer ${credential}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { res, json: await readJson(res) };
  };
  const fail = (what: string, res: Response, json: Record<string, unknown>): never => {
    const err = json.error as { code?: unknown } | undefined;
    const code =
      res.status === 401 ? 'unauthorized' : (str(err?.code, 60) ?? `http_${String(res.status)}`);
    throw new C0mputeError(code, `c0mpute ${what} failed (${String(res.status)})`, res.status);
  };

  return {
    async me(): Promise<LiveAccount> {
      const { res, json } = await call('GET', '/me');
      if (!res.ok) fail('account lookup', res, json);
      const account = (json.account ?? {}) as Record<string, unknown>;
      const free = (json.free_tier ?? {}) as Record<string, unknown>;
      const topUp = json.top_up;
      const tier = json.tier;
      const topUpUrl =
        httpsUrl(topUp) ??
        (topUp && typeof topUp === 'object'
          ? httpsUrl((topUp as Record<string, unknown>).url)
          : null);
      return {
        accountLabel: str(account.label, 200) ?? str(account.id, 200),
        tier: tier === 'paid' || tier === 'free' ? tier : null,
        balanceUsd: num(json.balance_usd),
        usdPerGb: num(json.usd_per_gb),
        freeTier: { maxHeight: num(free.max_height), maxViewers: num(free.max_viewers) },
        topUpUrl,
      };
    },

    /** 201: the stream and its one-time key. `conflict: true` on 409 (name taken). */
    async createStream(input: {
      name: string;
      title?: string;
      visibility?: 'public' | 'unlisted';
    }): Promise<{ conflict: true } | { conflict: false; stream: LiveStream; streamKey: string }> {
      const { res, json } = await call('POST', '/streams', input);
      if (res.status === 409) return { conflict: true };
      if (!res.ok) fail('stream create', res, json);
      const stream = streamFrom(json);
      const streamKey = str(json.stream_key, 500);
      if (!stream || !streamKey) {
        throw new C0mputeError('bad_response', 'c0mpute stream create returned no stream key');
      }
      return { conflict: false, stream, streamKey };
    },

    async listStreams(): Promise<LiveStream[]> {
      const { res, json } = await call('GET', '/streams');
      if (!res.ok) fail('stream list', res, json);
      const list: unknown = Array.isArray(json)
        ? json
        : Array.isArray(json.streams)
          ? json.streams
          : Array.isArray(json.data)
            ? json.data
            : [];
      return (list as unknown[]).map(streamFrom).filter((s): s is LiveStream => s !== null);
    },

    /** A fresh key for an existing stream (the old one stops working). */
    async rekey(streamId: string): Promise<string> {
      const { res, json } = await call('POST', `/streams/${encodeURIComponent(streamId)}/key`);
      if (!res.ok) fail('stream key', res, json);
      const streamKey = str(json.stream_key, 500);
      if (!streamKey) throw new C0mputeError('bad_response', 'c0mpute returned no stream key');
      return streamKey;
    },
  };
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export interface ChannelRef {
  id: string;
  handle: string;
  name: string;
}

export interface LiveLink {
  channel_id: string;
  user_id: string;
  stream_id: string;
  watch_url: string | null;
  playback_url: string | null;
  account_label: string | null;
}

export interface C0mputeLiveStore {
  /** Channels the acting user may configure (owner, org admin, team lead). */
  manageableChannels(): Promise<ChannelRef[]>;
  /**
   * Create or update the channel's one c0mpute restream destination, enabled.
   * Must refuse a channel the acting user may not manage.
   */
  upsertDestination(
    channelId: string,
    dest: { rtmpUrl: string; streamKey: string; label: string }
  ): Promise<void>;
  /**
   * Turn the channel's restream master switch on, but only when no other
   * destination would start streaming because of it.
   */
  enableRestreamIfSafe(channelId: string): Promise<void>;
  saveLink(link: LiveLink): Promise<void>;
}

/** The c0mpute stream name for a channel: its handle, which is unique on PairUX. */
export function streamNameFor(channel: ChannelRef): string {
  const slug = channel.handle
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `pairux-${channel.id.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
}

export interface ProvisionedChannel {
  channelId: string;
  handle: string;
  name: string;
  ok: boolean;
  watchUrl: string | null;
  /** A short code when ok is false; never c0mpute's raw message. */
  error?: string;
}

export interface ProvisionResult {
  accountLabel: string | null;
  channels: ProvisionedChannel[];
}

/**
 * For each channel the user manages: create a c0mpute stream named after the
 * channel (or, when the account already has one, fetch a fresh key for it),
 * then save the key as the channel's c0mpute restream destination and record
 * the watch link. One channel failing does not stop the others. A 401 stops
 * everything: the credential is bad or lacks live:publish.
 *
 * The credential is held by `api` only. Nothing here stores or returns it, and
 * the stream key goes to `store.upsertDestination` and nowhere else.
 */
export async function provision(
  input: { userId: string; accountLabel: string | null },
  api: Pick<ReturnType<typeof liveApi>, 'createStream' | 'listStreams' | 'rekey'>,
  store: C0mputeLiveStore
): Promise<ProvisionResult> {
  const channels = await store.manageableChannels();
  const out: ProvisionedChannel[] = [];
  let existing: LiveStream[] | null = null;

  for (const channel of channels) {
    const row: ProvisionedChannel = {
      channelId: channel.id,
      handle: channel.handle,
      name: channel.name,
      ok: false,
      watchUrl: null,
    };
    try {
      const name = streamNameFor(channel);
      const created = await api.createStream({
        name,
        title: channel.name.slice(0, 120) || name,
        visibility: 'public',
      });
      let stream: LiveStream;
      let streamKey: string;
      if (created.conflict) {
        existing ??= await api.listStreams();
        const found = existing.find((s) => s.name === name);
        if (!found) throw new C0mputeError('conflict', 'c0mpute stream name is taken');
        stream = found;
        streamKey = await api.rekey(found.id);
      } else {
        stream = created.stream;
        streamKey = created.streamKey;
      }
      await store.upsertDestination(channel.id, {
        rtmpUrl: C0MPUTE_RTMP_URL,
        streamKey,
        label: 'c0mpute Live',
      });
      await store.saveLink({
        channel_id: channel.id,
        user_id: input.userId,
        stream_id: stream.id,
        watch_url: stream.watchUrl,
        playback_url: stream.playbackUrl,
        account_label: input.accountLabel,
      });
      await store.enableRestreamIfSafe(channel.id).catch(() => undefined);
      row.ok = true;
      row.watchUrl = stream.watchUrl;
    } catch (err) {
      if (err instanceof C0mputeError && err.code === 'unauthorized') throw err;
      row.error = err instanceof C0mputeError ? err.code : 'save_failed';
    }
    out.push(row);
  }
  return { accountLabel: input.accountLabel, channels: out };
}

export interface ConnectResult {
  account: LiveAccount;
  result: ProvisionResult;
}

/**
 * The whole connect step for one credential (an OAuth access token or a pasted
 * API key): check it with /live/me, then provision every channel. The
 * credential goes no further than the `liveApi` closure built here, and is
 * unreachable once this returns.
 */
export async function connectWithCredential(
  cfg: Pick<C0mputeConfig, 'origin'>,
  credential: string,
  userId: string,
  store: C0mputeLiveStore,
  fetchImpl: FetchLike = fetch
): Promise<ConnectResult> {
  const api = liveApi(cfg, credential, fetchImpl);
  const account = await api.me();
  const result = await provision({ userId, accountLabel: account.accountLabel }, api, store);
  return { account, result };
}

/** The `?c0mpute=` value Settings shows after a connect attempt. */
export function outcomeCode(
  result: ProvisionResult
): 'connected' | 'partial' | 'nochannels' | 'failed' {
  if (result.channels.length === 0) return 'nochannels';
  const ok = result.channels.filter((c) => c.ok).length;
  if (ok === 0) return 'failed';
  return ok === result.channels.length ? 'connected' : 'partial';
}
