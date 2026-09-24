import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import { revokeToken } from '@/lib/cli-auth';

/**
 * POST /api/v1/cli/revoke — RFC 7009. Always 200, whether or not the token
 * existed, so the endpoint cannot be used to test tokens.
 */
export async function POST(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  let token: string | undefined;
  if (type.includes('application/x-www-form-urlencoded')) {
    token = new URLSearchParams(await request.text()).get('token') ?? undefined;
  } else {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    token = typeof body.token === 'string' ? body.token : undefined;
  }
  if (token) {
    await revokeToken(serviceClient(), token).catch((error: unknown) => {
      console.error('CLI revoke error:', error);
    });
  }
  return new NextResponse(null, { status: 200 });
}
