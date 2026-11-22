/**
 * Publish a recording into the user's c0mpute private storage, from the
 * browser, end to end encrypted.
 *
 * Everything here runs client side: PairUX registers itself as a public
 * OAuth client with c0mpute.com (sign-in there is CoinPay), gets a
 * `storage:write` token with PKCE, and @profullstack/c0mpute-sealed encrypts
 * the file to the user's linked storage identity before a byte leaves the
 * tab. The token can upload but never read, and it never reaches the PairUX
 * server. The returned #k= link holds the data key, so it is shown to the
 * user once and never stored.
 */

export const C0MPUTE_ORIGIN = 'https://c0mpute.com';
const SCOPE = 'storage:write';
const CLIENT_KEY = 'pairux.c0mpute.client';
const TOKEN_KEY = 'pairux.c0mpute.token';
const PENDING_KEY = 'pairux.c0mpute.pending';

export interface StoredToken {
  accessToken: string;
  /** ms epoch, when the server said; null = no expiry given. */
  expiresAt: number | null;
}

interface Pending {
  state: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function random(n = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function callbackUrl(origin: string): string {
  return `${origin}/recordings/c0mpute/callback`;
}

/** Only same-site paths may be returned to after sign-in. */
export function safeReturnTo(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    return '/recordings';
  return path;
}

async function clientId(redirectUri: string, fetchImpl: typeof fetch): Promise<string> {
  const store = storage('local');
  const cached = store?.getItem(CLIENT_KEY);
  if (cached) {
    try {
      const c = JSON.parse(cached) as { id: string; redirectUri: string };
      if (c.redirectUri === redirectUri && c.id) return c.id;
    } catch {
      // fall through and register again
    }
  }
  const res = await fetchImpl(`${C0MPUTE_ORIGIN}/api/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'PairUX',
      client_uri: 'https://pairux.com',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    client_id?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.client_id)
    throw new Error(
      body.error_description ?? body.error ?? `c0mpute registration failed (${String(res.status)})`
    );
  store?.setItem(CLIENT_KEY, JSON.stringify({ id: body.client_id, redirectUri }));
  return body.client_id;
}

/** Send the browser to c0mpute.com to approve uploads (sign-in there is CoinPay). */
export async function startConnect(
  returnTo: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const redirectUri = callbackUrl(window.location.origin);
  const id = await clientId(redirectUri, fetchImpl);
  const pending: Pending = {
    state: random(16),
    verifier: random(48),
    clientId: id,
    redirectUri,
    returnTo: safeReturnTo(returnTo),
  };
  storage('session')?.setItem(PENDING_KEY, JSON.stringify(pending));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state: pending.state,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: 'S256',
  });
  window.location.assign(`${C0MPUTE_ORIGIN}/oauth/authorize?${q.toString()}`);
}

/** Handle /recordings/c0mpute/callback: trade the code for a token. Returns where to go next. */
export async function finishConnect(
  params: URLSearchParams,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const raw = storage('session')?.getItem(PENDING_KEY);
  storage('session')?.removeItem(PENDING_KEY);
  if (!raw) throw new Error('This sign-in was not started here, or it expired. Try again.');
  const pending = JSON.parse(raw) as Pending;
  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') ?? `c0mpute: ${error}`);
  if (params.get('state') !== pending.state)
    throw new Error('Sign-in state did not match. Try again.');
  const code = params.get('code');
  if (!code) throw new Error('c0mpute did not return a code.');
  const res = await fetchImpl(`${C0MPUTE_ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token)
    throw new Error(
      body.error_description ?? body.error ?? `Token exchange failed (${String(res.status)})`
    );
  saveToken({
    accessToken: body.access_token,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
  });
  return pending.returnTo;
}

export function saveToken(token: StoredToken): void {
  storage('local')?.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function loadToken(now = Date.now()): string | null {
  const raw = storage('local')?.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as StoredToken;
    if (t.expiresAt && t.expiresAt - 60_000 < now) return null;
    return t.accessToken || null;
  } catch {
    return null;
  }
}

export function disconnect(): void {
  storage('local')?.removeItem(TOKEN_KEY);
}

/** File name for the encrypted object: the subject, made safe, plus .mp4. */
export function objectName(subject: string | null, createdAt: string): string {
  const base = (subject ?? '')
    .replace(/[^\p{L}\p{N} ._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || `PairUX recording ${createdAt.slice(0, 10)}`}.mp4`;
}

/**
 * Download a recording into memory with progress. The sealing library reads
 * the Blob in slices, but the bytes have to be in the tab first.
 */
export async function fetchRecording(
  url: string,
  onProgress: (done: number, total: number | null) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok || !res.body)
    throw new Error(`Could not download the recording (${String(res.status)})`);
  const total = Number(res.headers.get('content-length')) || null;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.byteLength;
    onProgress(done, total);
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get('content-type') ?? 'video/mp4' });
}
