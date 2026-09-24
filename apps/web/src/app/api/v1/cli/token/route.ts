import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { CliAuthError, exchangeCode, refreshTokens } from '@/lib/cli-auth';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';

const byIp = new FixedWindowRateLimiter(30, 60_000);

// OAuth token responses must never be cached (RFC 6749 §5.1).
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: NO_STORE }
  );
}

async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(await request.text()));
  }
  const json: unknown = await request.json().catch(() => ({}));
  if (!json || typeof json !== 'object') return {};
  return Object.fromEntries(
    Object.entries(json).filter((e): e is [string, string] => typeof e[1] === 'string')
  );
}

/**
 * POST /api/v1/cli/token — the OAuth 2.1 token endpoint for the PairUX CLI.
 * Accepts form or JSON bodies and answers in the standard OAuth shape.
 */
export async function POST(request: Request) {
  if (!byIp.check(getClientIp(request)).success) {
    return oauthError('slow_down', 'Too many token requests', 429);
  }
  try {
    const params = await readParams(request);
    const db = serviceClient();

    if (params.grant_type === 'authorization_code') {
      if (!params.code || !params.code_verifier || !params.redirect_uri) {
        return oauthError('invalid_request', 'code, code_verifier and redirect_uri are required');
      }
      const tokens = await exchangeCode(db, {
        code: params.code,
        codeVerifier: params.code_verifier,
        redirectUri: params.redirect_uri,
      });
      return NextResponse.json(tokens, { headers: NO_STORE });
    }

    if (params.grant_type === 'refresh_token') {
      if (!params.refresh_token) return oauthError('invalid_request', 'refresh_token is required');
      const tokens = await refreshTokens(db, params.refresh_token);
      return NextResponse.json(tokens, { headers: NO_STORE });
    }

    return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  } catch (error) {
    if (error instanceof CliAuthError) return oauthError(error.code, error.message);
    console.error('CLI token error:', error);
    return oauthError('server_error', 'Could not issue tokens', 500);
  }
}
