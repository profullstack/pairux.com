import { NextResponse } from 'next/server';
import { isAdminUser, requestUser } from '@/lib/request-user';
import { getCreditDeps } from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/admin/credit-codes/<id>: revoke a code (redemptions already made stand). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAdminUser(user.id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  try {
    await getCreditDeps().credits.revoke(id);
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'Unknown code' }, { status: 404 });
  }
}
