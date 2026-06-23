import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { exchangeCodeForTokens } from '@/lib/youtube';

/** Google redirects here with ?code. Verify state, store the refresh token. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const back = (status: string) =>
    NextResponse.redirect(new URL(`/settings?youtube=${status}`, appBase));

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code) return back('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get('yt_oauth_state')?.value;
  if (!state || !expectedState || state !== expectedState) return back('error');

  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.redirect(new URL('/login', appBase));

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh token on first consent. Re-consent forces
      // it (prompt=consent), but guard anyway.
      return back('noref');
    }

    // youtube_credentials isn't in the generated Database types yet (migration
    // ships in this PR), so the typed client infers `never` for the payload.
    await serviceClient()
      .from('youtube_credentials')
      .upsert({
        user_id: user.id,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope ?? null,
        updated_at: new Date().toISOString(),
      } as never);

    const res = back('connected');
    res.cookies.delete('yt_oauth_state');
    return res;
  } catch (err) {
    console.error('[youtube/callback] failed:', err);
    return back('error');
  }
}
