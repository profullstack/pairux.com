import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { finishSignIn, sameState } from '@profullstack/coinpay-onboard/oauth';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import {
  PENDING_COOKIE,
  PENDING_COOKIE_PATH,
  claimsFrom,
  coinpayConfig,
  decodePending,
  redirectUri,
  resolveCoinpayUser,
} from '@/lib/coinpay-signin';
import { mintMagicLinkHash, supabaseCoinpayStore } from '@/lib/coinpay-store';
import { INVITE_COOKIE, cookieFrom, onSignedIn, refFromRequest } from '@/lib/credits';

export const dynamic = 'force-dynamic';

/** CoinPay redirects here with ?code&state (or ?error). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cfg = coinpayConfig();
  const site = cfg?.siteUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  const pending = cfg
    ? decodePending(request.cookies.get(PENDING_COOKIE)?.value, cfg.clientSecret)
    : null;

  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, site));
    res.headers.set('cache-control', 'no-store');
    // Single use: the pending sign-in is spent whatever happens next.
    res.cookies.set(PENDING_COOKIE, '', { path: PENDING_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const fail = (code: string) =>
    go(pending?.mode === 'connect' ? `/settings?coinpay=${code}` : `/login?coinpay=${code}`);

  if (!cfg) return fail('unavailable');
  if (!pending) return fail('expired');
  if (!sameState(pending.state, params.get('state'))) return fail('state');
  const code = params.get('code');
  if (params.get('error') || !code) return fail('denied');

  let claims;
  try {
    const r = await finishSignIn({
      code,
      verifier: pending.verifier,
      nonce: pending.nonce,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: redirectUri(cfg),
      base: cfg.base,
    });
    claims = claimsFrom(r);
  } catch (err) {
    console.error('[coinpay] sign-in failed:', err instanceof Error ? err.message : err);
    return fail('failed');
  }

  const admin = serviceClient() as unknown as SupabaseClient;
  const store = supabaseCoinpayStore(admin);

  let currentUserId: string | null = null;
  if (pending.mode === 'connect') {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    currentUserId = user?.id ?? null;
  }

  let result;
  try {
    result = await resolveCoinpayUser({ mode: pending.mode, currentUserId, claims }, store);
  } catch (err) {
    console.error('[coinpay] resolve failed:', err instanceof Error ? err.message : err);
    return fail('failed');
  }
  if (!result.ok) return fail(result.code);
  if (pending.mode === 'connect') return go('/settings?coinpay=connected');

  const minted = await mintMagicLinkHash(admin, result.userId);
  if (!minted.ok) return fail(minted.code);

  const response = go(pending.next);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options });
          });
        },
      },
    }
  );
  const { error } = await supabase.auth.verifyOtp({
    token_hash: minted.tokenHash,
    type: 'magiclink',
  });
  if (error) {
    console.error('[coinpay] session mint failed:', error.message);
    return fail('session');
  }

  // Same post-sign-in step as /auth/callback: a pending /i/<code> invite and a
  // ?ref= attribution. The invite bonus stays pending for CoinPay-made
  // accounts (credits.ts treats the placeholder address as unconfirmed).
  try {
    await onSignedIn(result.userId, {
      inviteCode: cookieFrom(request, INVITE_COOKIE),
      refCode: refFromRequest(request),
    });
    if (request.cookies.get(INVITE_COOKIE)) response.cookies.delete(INVITE_COOKIE);
  } catch (err) {
    console.error('[coinpay] invite settle failed', err);
  }
  return response;
}
