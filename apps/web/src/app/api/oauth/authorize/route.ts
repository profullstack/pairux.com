import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  AUTHORIZE_FIELDS,
  checkAuthorize,
  errorRedirect,
  issueCode,
  OAuthError,
  sameOrigin,
  siteOrigin,
  type AuthorizeParams,
  oauthDb,
} from '@/lib/mcp-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

const see = (url: string) => NextResponse.redirect(url, { status: 303, headers: NO_STORE });

/**
 * POST /api/oauth/authorize: the consent form at /oauth/authorize (the
 * advertised authorization_endpoint) posts here, form-encoded, with
 * decision=allow|deny and the original request as hidden fields. The user is
 * the signed-in Supabase session (cookie). Answers 303 to the client's
 * redirect_uri with code, state and iss (RFC 9207), or with the error.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Cross-site request refused' },
      { status: 403, headers: NO_STORE }
    );
  }
  const form = new URLSearchParams(await req.text());
  const p: AuthorizeParams = {};
  for (const k of AUTHORIZE_FIELDS) {
    const v = form.get(k);
    if (v !== null) (p as Record<string, unknown>)[k] = v;
  }
  const decision = form.get('decision');
  if (decision !== 'allow' && decision !== 'deny') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'decision must be allow or deny' },
      { status: 400, headers: NO_STORE }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const qs = new URLSearchParams(p as Record<string, string>).toString();
  if (!user) {
    return see(`${siteOrigin()}/login?redirect=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const admin = oauthDb();
  const check = await checkAuthorize(admin, p);
  if (!check.ok) {
    if ('redirect' in check) return see(check.redirect);
    return NextResponse.json(
      { error: check.error, error_description: check.description },
      { status: 400, headers: NO_STORE }
    );
  }
  if (decision === 'deny') {
    return see(
      errorRedirect(check.redirectUri, 'access_denied', 'The user denied the request', check.state)
    );
  }
  try {
    return see(await issueCode(admin, check, user.id));
  } catch (err) {
    if (err instanceof OAuthError)
      return NextResponse.json(err.body(), { status: err.status, headers: NO_STORE });
    console.error('[oauth] authorize failed', (err as Error).message);
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE });
  }
}
