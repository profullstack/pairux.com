import { NextResponse } from 'next/server';
import { requestUser } from '@/lib/request-user';
import { InviteError, revokeInvite } from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/invites/<id>: withdraw an unused invite (refunds the slot). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await revokeInvite(user.id, id);
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json({ error: err.message, reason: err.reason }, { status: err.status });
    }
    console.error('[invites] revoke failed', err);
    return NextResponse.json({ error: 'Could not withdraw the invite.' }, { status: 500 });
  }
}
