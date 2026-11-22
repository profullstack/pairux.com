import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import {
  PENDING_COOKIE,
  PENDING_COOKIE_PATH,
  PENDING_TTL,
  beginConnect,
  c0mputeConfig,
  discoverEndpoints,
  encodePending,
  ensureClientId,
} from '@/lib/c0mpute-live';
import { supabaseClientCache } from '@/lib/c0mpute-live-store';

export const dynamic = 'force-dynamic';

/** GET (signed in)  ->  302 to c0mpute.com's authorize page for live:publish. */
export async function GET(request: NextRequest) {
  const cfg = c0mputeConfig();
  const site = cfg?.siteUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  const settings = (code: string) => {
    const res = NextResponse.redirect(new URL(`/settings?c0mpute=${code}#c0mpute`, site));
    res.headers.set('cache-control', 'no-store');
    return res;
  };
  if (!cfg) return settings('unavailable');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login?redirect=/settings', site));

  const endpoints = await discoverEndpoints(cfg);
  let clientId: string;
  try {
    clientId = await ensureClientId(
      cfg,
      supabaseClientCache(serviceClient() as unknown as SupabaseClient),
      endpoints
    );
  } catch (err) {
    console.error('[c0mpute-live] registration failed:', err instanceof Error ? err.message : err);
    return settings('unavailable');
  }

  const { pending, url } = beginConnect(cfg, endpoints, {
    clientId,
    userId: user.id,
    retried: request.nextUrl.searchParams.get('retry') === '1',
  });
  const response = NextResponse.redirect(url);
  response.headers.set('cache-control', 'no-store');
  response.cookies.set(PENDING_COOKIE, encodePending(pending, cfg.stateSecret), {
    httpOnly: true,
    // lax: c0mpute's redirect back is a top-level GET navigation, which lax allows.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: PENDING_COOKIE_PATH,
    maxAge: PENDING_TTL,
  });
  return response;
}
