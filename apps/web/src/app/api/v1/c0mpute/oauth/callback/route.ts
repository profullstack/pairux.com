import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import {
  C0mputeError,
  PENDING_COOKIE,
  PENDING_COOKIE_PATH,
  c0mputeConfig,
  connectWithCredential,
  decodePending,
  discoverEndpoints,
  exchangeCode,
  outcomeCode,
  sameState,
} from '@/lib/c0mpute-live';
import { supabaseC0mputeLiveStore, supabaseClientCache } from '@/lib/c0mpute-live-store';

export const dynamic = 'force-dynamic';

/**
 * c0mpute.com redirects here with ?code&state (or ?error). The access token
 * exists only inside this request: it provisions the channels and is dropped.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cfg = c0mputeConfig();
  const site = cfg?.siteUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  const pending = cfg
    ? decodePending(request.cookies.get(PENDING_COOKIE)?.value, cfg.stateSecret)
    : null;

  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, site));
    res.headers.set('cache-control', 'no-store');
    // Single use: the pending authorization is spent whatever happens next.
    res.cookies.set(PENDING_COOKIE, '', { path: PENDING_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const done = (code: string, extra = '') => go(`/settings?c0mpute=${code}${extra}#c0mpute`);

  if (!cfg) return done('unavailable');
  if (!pending) return done('expired');
  if (!sameState(pending.state, params.get('state'))) return done('state');

  const admin = serviceClient() as unknown as SupabaseClient;
  const cache = supabaseClientCache(admin);
  /** c0mpute no longer knows our client id: forget it and start over, once. */
  const reRegister = async () => {
    await cache.clearClient().catch(() => undefined);
    return pending.retried ? done('failed') : go('/api/v1/c0mpute/oauth/start?retry=1');
  };

  const oauthError = params.get('error');
  if (oauthError === 'invalid_client' || oauthError === 'unauthorized_client') {
    return reRegister();
  }
  const code = params.get('code');
  if (oauthError || !code) return done('denied');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The session that comes back must be the one that started.
  if (user?.id !== pending.userId) return done('session');

  try {
    const endpoints = await discoverEndpoints(cfg);
    const token = await exchangeCode(cfg, endpoints, {
      code,
      verifier: pending.verifier,
      clientId: pending.clientId,
    });
    const { account, result } = await connectWithCredential(
      cfg,
      token,
      user.id,
      supabaseC0mputeLiveStore(supabase as unknown as SupabaseClient, admin)
    );
    return done(outcomeCode(result), account.tier ? `&tier=${account.tier}` : '');
  } catch (err) {
    if (err instanceof C0mputeError && err.code === 'invalid_client') return reRegister();
    // C0mputeError messages carry a status and a code, never a token or a key.
    console.error('[c0mpute-live] connect failed:', err instanceof Error ? err.message : 'error');
    return done(err instanceof C0mputeError && err.code === 'unauthorized' ? 'scope' : 'failed');
  }
}
