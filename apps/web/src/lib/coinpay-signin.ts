// Sign in with CoinPay (CoinPay is the house master account).
//
// Confidential OIDC client: authorization code + PKCE S256 + state + nonce,
// redirect https://pairux.com/api/v1/coinpay/oauth/callback, scopes
// "openid profile email". The protocol half (authorize URL, code exchange,
// id_token checks, userinfo) is @profullstack/coinpay-onboard/oauth.
//
// STANDING security rule: a CoinPay login binds to the CoinPay `sub` in
// public.coinpay_identities. It never signs in to an existing account because
// the CoinPay email matches (CoinPay never verifies emails), never stores that
// email as the account's auth email, and never grants anything from it.
// Linking CoinPay to an existing account happens only from Settings while
// signed in. A first CoinPay login with no link creates a NEW PairUX account
// whose auth email is an undeliverable placeholder; the CoinPay email is kept
// on the identity row as unverified contact info.
//
// The decision logic is written against the CoinpayStore interface so tests run
// in memory; coinpay-store.ts is the Supabase one.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  authorizeUrl as cpAuthorizeUrl,
  pkce,
  randomToken,
  SIGN_IN_SCOPES,
} from '@profullstack/coinpay-onboard/oauth';
import { sameOriginPath } from '@/lib/safe-redirect';

export const COINPAY_BASE = 'https://coinpayportal.com';
export const CALLBACK_PATH = '/api/v1/coinpay/oauth/callback';
export const PENDING_COOKIE = 'pux_cp_oauth';
export const PENDING_COOKIE_PATH = '/api/v1/coinpay/oauth';
export const PENDING_TTL = 600;
/** Auth emails of accounts a CoinPay login created. `.invalid` never receives mail (RFC 2606). */
export const PLACEHOLDER_EMAIL_DOMAIN = 'coinpay.pairux.invalid';

// Read at request time through a variable key: Next inlines `process.env.NAME`
// at build time, server code included, which would bake a missing secret in.
function runtimeEnv(name: string): string {
  const v = (process.env as Record<string, string | undefined>)[name];
  return typeof v === 'string' ? v.trim() : '';
}

export interface CoinpayConfig {
  clientId: string;
  clientSecret: string;
  base: string;
  siteUrl: string;
}

export function coinpayConfig(): CoinpayConfig | null {
  const clientId = runtimeEnv('COINPAY_OAUTH_CLIENT_ID');
  const clientSecret = runtimeEnv('COINPAY_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  const base = (runtimeEnv('COINPAY_OAUTH_ISSUER') || COINPAY_BASE).replace(/\/+$/, '');
  // The redirect URI must equal the registration, so it is the canonical host,
  // never whatever Host header the request carried.
  const siteUrl = (runtimeEnv('NEXT_PUBLIC_APP_URL') || 'https://pairux.com').replace(/\/+$/, '');
  return { clientId, clientSecret, base, siteUrl };
}

export const redirectUri = (cfg: Pick<CoinpayConfig, 'siteUrl'>) => cfg.siteUrl + CALLBACK_PATH;

export type OAuthMode = 'login' | 'connect';

export interface PendingAuth {
  state: string;
  verifier: string;
  nonce: string;
  mode: OAuthMode;
  next: string;
  exp: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export function safeNext(next: string | null | undefined, mode: OAuthMode = 'login'): string {
  return sameOriginPath(next) ?? (mode === 'connect' ? '/settings' : '/dashboard');
}

/** A fresh pending sign-in plus the authorize URL that starts it. */
export function beginSignIn(
  cfg: CoinpayConfig,
  mode: OAuthMode,
  next: string | null
): { pending: PendingAuth; url: string } {
  const { verifier, challenge } = pkce();
  const pending: PendingAuth = {
    state: randomToken(),
    verifier,
    nonce: randomToken(),
    mode,
    next: safeNext(next, mode),
    exp: nowSec() + PENDING_TTL,
  };
  const url = cpAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: redirectUri(cfg),
    state: pending.state,
    nonce: pending.nonce,
    challenge,
    scopes: SIGN_IN_SCOPES,
    base: cfg.base,
  });
  return { pending, url };
}

function mac(value: string, key: string): string {
  return createHmac('sha256', `pairux-coinpay-pending:${key}`).update(value).digest('base64url');
}

/** HMAC-sealed under the client secret, so a browser can hold it but not forge or edit it. */
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
      typeof o.nonce !== 'string'
    )
      return null;
    if (o.mode !== 'login' && o.mode !== 'connect') return null;
    if (typeof o.exp !== 'number' || o.exp < nowSec()) return null;
    return {
      state: o.state,
      verifier: o.verifier,
      nonce: o.nonce,
      mode: o.mode,
      next: safeNext(o.next, o.mode),
      exp: o.exp,
    };
  } catch {
    return null;
  }
}

export interface CoinpayClaims {
  sub: string;
  email: string | null;
  name: string | null;
}

/** Trim what CoinPay returned to what is stored; the email is contact info only. */
export function claimsFrom(r: {
  sub: string;
  email: string | null;
  name: string | null;
}): CoinpayClaims {
  const email = typeof r.email === 'string' && r.email.includes('@') ? r.email.slice(0, 320) : null;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 200) : null;
  return { sub: r.sub, email, name };
}

export interface IdentityRow {
  user_id: string;
  coinpay_sub: string;
  coinpay_email: string | null;
  created_via: 'connect' | 'signup';
}

export interface CoinpayStore {
  identityBySub(sub: string): Promise<IdentityRow | null>;
  identityByUser(userId: string): Promise<IdentityRow | null>;
  /** Insert; "conflict" when the sub or the user is already bound. */
  link(row: IdentityRow & { coinpay_name: string | null }): Promise<'ok' | 'conflict'>;
  unlink(userId: string): Promise<void>;
  touch(sub: string): Promise<void>;
  /** A brand-new auth user with a placeholder email (confirmed: the address is ours). */
  createUser(input: {
    email: string;
    name: string | null;
    contactEmail: string | null;
  }): Promise<string>;
  deleteUser(userId: string): Promise<void>;
}

export function placeholderEmail(): string {
  return `cp-${randomBytes(12).toString('hex')}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('@' + PLACEHOLDER_EMAIL_DOMAIN);
}

export type ResolutionError = 'not_signed_in' | 'linked_elsewhere' | 'already_connected';
export type Resolution =
  | { ok: true; userId: string; action: 'login' | 'created' | 'linked' }
  | { ok: false; code: ResolutionError };

/**
 * Which PairUX user a verified CoinPay sub belongs to. Never looks at the
 * email: a CoinPay login carrying an existing user's address gets a NEW
 * account (or the one already bound to its sub), never that user's.
 */
export async function resolveCoinpayUser(
  input: { mode: OAuthMode; currentUserId: string | null; claims: CoinpayClaims },
  store: CoinpayStore
): Promise<Resolution> {
  const { claims } = input;
  const bound = await store.identityBySub(claims.sub);

  if (input.mode === 'connect') {
    if (!input.currentUserId) return { ok: false, code: 'not_signed_in' };
    if (bound) {
      return bound.user_id === input.currentUserId
        ? { ok: true, userId: bound.user_id, action: 'linked' }
        : { ok: false, code: 'linked_elsewhere' };
    }
    if (await store.identityByUser(input.currentUserId))
      return { ok: false, code: 'already_connected' };
    const r = await store.link({
      user_id: input.currentUserId,
      coinpay_sub: claims.sub,
      coinpay_email: claims.email,
      coinpay_name: claims.name,
      created_via: 'connect',
    });
    if (r === 'conflict') return { ok: false, code: 'linked_elsewhere' };
    return { ok: true, userId: input.currentUserId, action: 'linked' };
  }

  if (bound) {
    await store.touch(claims.sub);
    return { ok: true, userId: bound.user_id, action: 'login' };
  }

  const userId = await store.createUser({
    email: placeholderEmail(),
    name: claims.name,
    contactEmail: claims.email,
  });
  const r = await store.link({
    user_id: userId,
    coinpay_sub: claims.sub,
    coinpay_email: claims.email,
    coinpay_name: claims.name,
    created_via: 'signup',
  });
  if (r === 'conflict') {
    // Lost a race with a parallel first login for the same sub: keep theirs.
    await store.deleteUser(userId).catch(() => undefined);
    const again = await store.identityBySub(claims.sub);
    if (again) return { ok: true, userId: again.user_id, action: 'login' };
    return { ok: false, code: 'linked_elsewhere' };
  }
  return { ok: true, userId, action: 'created' };
}

/**
 * Disconnect is refused when CoinPay is the only way in: a placeholder auth
 * email has no password and cannot receive a reset link.
 */
export function canDisconnect(authEmail: string | null | undefined): boolean {
  return !!authEmail && !isPlaceholderEmail(authEmail);
}
