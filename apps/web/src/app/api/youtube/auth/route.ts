import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { buildAuthUrl, youtubeOAuthConfigured } from '@/lib/youtube';

/** Start the YouTube OAuth flow: set a CSRF state cookie, redirect to Google. */
export async function GET(request: Request) {
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  if (!youtubeOAuthConfigured()) {
    return NextResponse.redirect(new URL('/settings?youtube=unconfigured', appBase));
  }

  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) {
    return NextResponse.redirect(new URL('/login', appBase));
  }

  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set('yt_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
