/**
 * PairUX CLI sign-in: OAuth 2.1 authorization code + PKCE (S256) over a
 * loopback redirect (RFC 8252), with rotating refresh tokens.
 *
 * The CLI opens /cli/authorize in the browser with a code_challenge and a
 * http://127.0.0.1:<port>/callback redirect. The signed-in user approves, the
 * browser lands on the loopback with a one-time code, and the CLI trades the
 * code plus its code_verifier at /api/v1/cli/token for an opaque access token
 * (1 hour) and refresh token (60 days). Every refresh rotates both; replaying a
 * refresh token that was already rotated revokes the whole family.
 *
 * Only SHA-256 hashes of codes and tokens are stored. Every function takes its
 * database client as an argument so tests can hand in a fake.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ACCESS_TOKEN_PREFIX = 'pux_at_';
export const REFRESH_TOKEN_PREFIX = 'pux_rt_';
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 60 * 24 * 60 * 60;
export const CODE_TTL_SECONDS = 5 * 60;

// The service-role client (see serviceClient()); tests hand in an in-memory fake.
export type Db = SupabaseClient;

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

export class CliAuthError extends Error {
  constructor(
    /** An OAuth 2.1 error code: invalid_request, invalid_grant, ... */
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function randomSecret(prefix = ''): string {
  return prefix + base64url(randomBytes(32));
}

/** S256: BASE64URL(SHA256(verifier)) must equal the challenge sent at authorize time. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  // RFC 7636 §4.1: 43-128 chars from the unreserved set.
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(base64url(createHash('sha256').update(verifier).digest()));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function isValidChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

/**
 * Only loopback redirects are accepted (RFC 8252 §7.3): the code can land on
 * the machine that asked for it and nowhere else. Any port, fixed path.
 */
export function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') &&
    url.port !== '' &&
    url.pathname === '/callback' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

/** Issue a one-time authorization code for a user who approved the CLI. */
export async function createAuthCode(
  db: Db,
  args: { userId: string; codeChallenge: string; redirectUri: string; clientName?: string | null },
  now = new Date()
): Promise<string> {
  if (!isValidChallenge(args.codeChallenge)) {
    throw new CliAuthError('invalid_request', 'code_challenge must be an S256 challenge');
  }
  if (!isLoopbackRedirect(args.redirectUri)) {
    throw new CliAuthError('invalid_request', 'redirect_uri must be a loopback /callback URL');
  }
  const code = randomSecret();
  const { error } = await db.from('cli_auth_codes').insert({
    code_hash: sha256Hex(code),
    user_id: args.userId,
    code_challenge: args.codeChallenge,
    redirect_uri: args.redirectUri,
    client_name: args.clientName ?? null,
    expires_at: new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error('Could not create authorization code');
  return code;
}

async function issueTokens(
  db: Db,
  args: { userId: string; clientName: string | null; familyId?: string },
  now: Date
): Promise<TokenResponse> {
  const accessToken = randomSecret(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomSecret(REFRESH_TOKEN_PREFIX);
  const { error } = await db.from('cli_tokens').insert({
    family_id: args.familyId ?? crypto.randomUUID(),
    user_id: args.userId,
    client_name: args.clientName,
    access_hash: sha256Hex(accessToken),
    refresh_hash: sha256Hex(refreshToken),
    access_expires_at: new Date(now.getTime() + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error('Could not issue tokens');
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
  };
}

/** grant_type=authorization_code */
export async function exchangeCode(
  db: Db,
  args: { code: string; codeVerifier: string; redirectUri: string },
  now = new Date()
): Promise<TokenResponse> {
  const codeHash = sha256Hex(args.code);
  // Claim the code atomically: only the first exchange sees used_at IS NULL.
  const { data: rows, error } = await db
    .from('cli_auth_codes')
    .update({ used_at: now.toISOString() })
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .select('user_id, code_challenge, redirect_uri, client_name, expires_at');
  const row = (Array.isArray(rows) ? rows[0] : null) as {
    user_id: string;
    code_challenge: string;
    redirect_uri: string;
    client_name: string | null;
    expires_at: string;
  } | null;
  if (error || !row) throw new CliAuthError('invalid_grant', 'Authorization code is invalid');
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new CliAuthError('invalid_grant', 'Authorization code has expired');
  }
  if (row.redirect_uri !== args.redirectUri) {
    throw new CliAuthError('invalid_grant', 'redirect_uri does not match');
  }
  if (!verifyPkce(args.codeVerifier, row.code_challenge)) {
    throw new CliAuthError('invalid_grant', 'code_verifier does not match');
  }
  return issueTokens(db, { userId: row.user_id, clientName: row.client_name }, now);
}

interface TokenRow {
  id: string;
  family_id: string;
  user_id: string;
  client_name: string | null;
  access_expires_at: string;
  refresh_expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

const TOKEN_COLUMNS =
  'id, family_id, user_id, client_name, access_expires_at, refresh_expires_at, rotated_at, revoked_at';

async function revokeFamily(db: Db, familyId: string, now: Date): Promise<void> {
  await db
    .from('cli_tokens')
    .update({ revoked_at: now.toISOString() })
    .eq('family_id', familyId)
    .is('revoked_at', null);
}

/** grant_type=refresh_token. Rotates; a replayed refresh token kills the family. */
export async function refreshTokens(
  db: Db,
  refreshToken: string,
  now = new Date()
): Promise<TokenResponse> {
  const { data } = await db
    .from('cli_tokens')
    .select(TOKEN_COLUMNS)
    .eq('refresh_hash', sha256Hex(refreshToken))
    .maybeSingle();
  const row = data as TokenRow | null;
  if (!row || row.revoked_at) throw new CliAuthError('invalid_grant', 'Refresh token is invalid');
  if (row.rotated_at) {
    await revokeFamily(db, row.family_id, now);
    throw new CliAuthError('invalid_grant', 'Refresh token was already used; sign in again');
  }
  if (new Date(row.refresh_expires_at).getTime() <= now.getTime()) {
    throw new CliAuthError('invalid_grant', 'Refresh token has expired; sign in again');
  }
  // Claim the rotation atomically so two concurrent refreshes cannot both win.
  const { data: claimed } = await db
    .from('cli_tokens')
    .update({ rotated_at: now.toISOString() })
    .eq('id', row.id)
    .is('rotated_at', null)
    .select('id');
  if (!Array.isArray(claimed) || claimed.length === 0) {
    await revokeFamily(db, row.family_id, now);
    throw new CliAuthError('invalid_grant', 'Refresh token was already used; sign in again');
  }
  return issueTokens(
    db,
    { userId: row.user_id, clientName: row.client_name, familyId: row.family_id },
    now
  );
}

/** RFC 7009: revoking either token of a pair ends that sign-in entirely. */
export async function revokeToken(db: Db, token: string, now = new Date()): Promise<void> {
  const column = token.startsWith(REFRESH_TOKEN_PREFIX) ? 'refresh_hash' : 'access_hash';
  const { data } = await db
    .from('cli_tokens')
    .select('family_id')
    .eq(column, sha256Hex(token))
    .maybeSingle();
  const row = data as { family_id: string } | null;
  if (row) await revokeFamily(db, row.family_id, now);
}

/**
 * Resolve `Authorization: Bearer pux_at_...` to the user it was issued to, or
 * null. Anything else (no header, a Supabase JWT, an expired or revoked
 * token) is null: routes that accept CLI tokens treat that as anonymous.
 */
export async function getCliUser(
  db: Db,
  request: Request,
  now = new Date()
): Promise<{ userId: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(pux_at_[A-Za-z0-9_-]+)$/.exec(header);
  if (!match?.[1]) return null;
  const { data } = await db
    .from('cli_tokens')
    .select(TOKEN_COLUMNS)
    .eq('access_hash', sha256Hex(match[1]))
    .maybeSingle();
  const row = data as TokenRow | null;
  // A rotated pair's access token is superseded by the one issued alongside it.
  if (!row || row.revoked_at || row.rotated_at) return null;
  if (new Date(row.access_expires_at).getTime() <= now.getTime()) return null;
  // Supabase query builders are lazy: without .then() this update never runs.
  void db
    .from('cli_tokens')
    .update({ last_used_at: now.toISOString() })
    .eq('id', row.id)
    .then(
      () => undefined,
      () => undefined
    );
  return { userId: row.user_id };
}
