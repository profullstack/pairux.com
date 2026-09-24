/**
 * `pairux login`: OAuth 2.1 authorization code + PKCE (S256) over a loopback
 * redirect (RFC 8252). No password or pasted token ever touches the terminal.
 *
 * 1. Make a code_verifier and its S256 challenge, and a random state.
 * 2. Listen on 127.0.0.1:<random port>/callback.
 * 3. Open <api>/cli/authorize?... in the browser; the user approves there.
 * 4. The browser lands on the loopback with ?code&state; check state.
 * 5. POST the code + verifier to /api/v1/cli/token for access + refresh tokens.
 *
 * Refresh tokens rotate on every use, so the new pair is saved each time.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import type { StoredTokens } from './config.js';

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  const verifier = randomBytes(48).toString('base64url'); // 64 chars
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(
  apiUrl: string,
  args: { challenge: string; redirectUri: string; state: string; clientName: string }
): string {
  const url = new URL('/cli/authorize', apiUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('client_name', args.clientName);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export class AuthError extends Error {}

async function tokenRequest(
  apiUrl: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  now: () => number
): Promise<StoredTokens> {
  const res = await fetchImpl(`${apiUrl}/api/v1/cli/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new AuthError(
      body.error_description ?? body.error ?? `Sign-in failed (${String(res.status)})`
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now() + (body.expires_in ?? 3600) * 1000,
  };
}

export function exchangeCode(
  apiUrl: string,
  args: { code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<StoredTokens> {
  return tokenRequest(
    apiUrl,
    {
      grant_type: 'authorization_code',
      code: args.code,
      code_verifier: args.verifier,
      redirect_uri: args.redirectUri,
    },
    fetchImpl,
    now
  );
}

export function refresh(
  apiUrl: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<StoredTokens> {
  return tokenRequest(
    apiUrl,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchImpl,
    now
  );
}

export async function revoke(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  await fetchImpl(`${apiUrl}/api/v1/cli/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}

/** Refresh a minute early so a token never expires mid-request. */
export function needsRefresh(tokens: StoredTokens, now = Date.now()): boolean {
  return tokens.expiresAt - 60_000 <= now;
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>PairUX CLI</title>
<body style="font-family:system-ui;text-align:center;padding:4rem">
<h1>You're signed in</h1><p>You can close this tab and return to your terminal.</p></body>`;

const FAIL_PAGE = `<!doctype html><meta charset="utf-8"><title>PairUX CLI</title>
<body style="font-family:system-ui;text-align:center;padding:4rem">
<h1>Sign-in did not complete</h1><p>Return to your terminal for details.</p></body>`;

/**
 * Wait on a loopback server for the browser to come back with ?code&state.
 * Resolves with the code; rejects on a state mismatch, a denial, or timeout.
 */
export function listenForCallback(opts: { timeoutMs?: number } = {}): Promise<{
  redirectUri: string;
  waitForCode: (state: string) => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolveListen, rejectListen) => {
    let server: Server | null = null;
    let settle: ((result: { code?: string; error?: string; state?: string }) => void) | null = null;
    const pending: { code?: string; error?: string; state?: string }[] = [];

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const result: { code?: string; error?: string; state?: string } = {};
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');
      if (code) result.code = code;
      if (error) result.error = error;
      if (state) result.state = state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(code ? DONE_PAGE : FAIL_PAGE);
      if (settle) settle(result);
      else pending.push(result);
    });

    server.on('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') {
        rejectListen(new Error('Could not open a local port for sign-in'));
        return;
      }
      const close = () => {
        server?.close();
        server = null;
      };
      resolveListen({
        redirectUri: `http://127.0.0.1:${String(address.port)}/callback`,
        close,
        waitForCode: (expectedState) =>
          new Promise<string>((resolve, reject) => {
            const timer = setTimeout(
              () => {
                reject(
                  new AuthError('Timed out waiting for the browser. Run `pairux login` again.')
                );
              },
              opts.timeoutMs ?? 5 * 60_000
            );
            settle = (result) => {
              clearTimeout(timer);
              if (result.state !== expectedState) {
                reject(new AuthError('Sign-in state did not match; ignoring that callback.'));
              } else if (result.error || !result.code) {
                reject(
                  new AuthError(
                    result.error === 'access_denied'
                      ? 'Sign-in was denied in the browser.'
                      : `Sign-in failed: ${result.error ?? 'no code returned'}`
                  )
                );
              } else {
                resolve(result.code);
              }
            };
            const early = pending.shift();
            if (early) settle(early);
          }),
      });
    });
  });
}

/** Best-effort: open a URL in the default browser. The URL is always printed too. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // No browser available (SSH, container). The printed URL is the fallback.
  }
}

export function randomState(): string {
  return randomBytes(16).toString('base64url');
}
