import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  PENDING_COOKIE,
  PENDING_COOKIE_PATH,
  PENDING_TTL,
  beginSignIn,
  coinpayConfig,
  encodePending,
} from '@/lib/coinpay-signin';

export const dynamic = 'force-dynamic';

/** GET ?mode=login|connect&next=/path  ->  302 to CoinPay's authorize page. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('mode') === 'connect' ? 'connect' : 'login';
  const cfg = coinpayConfig();
  const site = cfg?.siteUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  if (!cfg) {
    return NextResponse.redirect(
      new URL(
        mode === 'connect' ? '/settings?coinpay=unavailable' : '/login?coinpay=unavailable',
        site
      )
    );
  }
  // Connecting attaches CoinPay to the account you are in; there must be one.
  if (mode === 'connect') {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(new URL('/login?redirect=/settings', site));
  }

  const { pending, url } = beginSignIn(cfg, mode, params.get('next'));
  const response = NextResponse.redirect(url);
  response.headers.set('cache-control', 'no-store');
  response.cookies.set(PENDING_COOKIE, encodePending(pending, cfg.clientSecret), {
    httpOnly: true,
    // lax: CoinPay's redirect back is a top-level GET navigation, which lax allows.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: PENDING_COOKIE_PATH,
    maxAge: PENDING_TTL,
  });
  return response;
}
