/* eslint-disable @typescript-eslint/no-deprecated */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCodeAndPersist } from '@/lib/supabase/exchange-code';
import { INVITE_COOKIE, cookieFrom, onSignedIn, refFromRequest } from '@/lib/credits';

/**
 * A confirmed sign-in: accept a pending /i/<code> invite, record a ?ref=
 * attribution and settle any invite bonus held for email confirmation.
 * Never blocks the redirect on failure.
 */
async function afterSignIn(
  request: NextRequest,
  response: NextResponse,
  userId: string | undefined
) {
  if (!userId) return;
  try {
    await onSignedIn(userId, {
      inviteCode: cookieFrom(request, INVITE_COOKIE),
      refCode: refFromRequest(request),
    });
    if (request.cookies.get(INVITE_COOKIE)) response.cookies.delete(INVITE_COOKIE);
  } catch (err) {
    console.error('[auth/callback] invite settle failed', err);
  }
}

export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/dashboard';
  }

  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeNextPath(searchParams.get('next'));
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  // Need either a code or token_hash
  if (!code && !tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // Create redirect response first so we can attach cookies to it
  const redirectUrl = new URL(next, origin);
  const response = NextResponse.redirect(redirectUrl);

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
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
  });

  // The account GoTrue verified, from either flow below. Only a verified id
  // reaches afterSignIn.
  let verifiedUserId: string | undefined;

  // Handle token_hash from direct email links
  if (tokenHash && type) {
    const otpType = type as 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email';
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });

    if (error) {
      console.error('Auth callback token verification error:', error);
      return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
    }

    verifiedUserId = data.user?.id;
  } else if (code) {
    // Handle code from PKCE flow
    const { session, error } = await exchangeCodeAndPersist(supabase, code);

    if (error) {
      console.error('Auth callback code exchange error:', error);
      return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
    }

    verifiedUserId = session?.user.id;
  }

  if (verifiedUserId) await afterSignIn(request, response, verifiedUserId);

  return response;
}
