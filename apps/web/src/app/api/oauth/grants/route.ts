import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listGrants, revokeGrant, oauthDb } from '@/lib/mcp-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function userId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const unauthorized = () => NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

// GET /api/oauth/grants: the signed-in user's connected apps (ChatGPT, Claude, …).
export async function GET() {
  const uid = await userId();
  if (!uid) return unauthorized();
  return NextResponse.json(
    { grants: await listGrants(oauthDb(), uid) },
    { headers: { 'cache-control': 'no-store' } }
  );
}

// DELETE /api/oauth/grants?id=<grant id>: disconnect one app; its tokens stop working at once.
export async function DELETE(req: NextRequest) {
  const uid = await userId();
  if (!uid) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const ok = await revokeGrant(oauthDb(), uid, id);
  return ok
    ? NextResponse.json({ revoked: true })
    : NextResponse.json({ error: 'No such connected app' }, { status: 404 });
}
