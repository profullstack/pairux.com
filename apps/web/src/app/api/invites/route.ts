import { NextResponse } from 'next/server';
import { requestUser } from '@/lib/request-user';
import {
  InviteError,
  createInvite,
  inviteOverview,
  inviteUrl,
  publicOrigin,
  refUrl,
  settleInvitesSentBy,
} from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/invites: quota, invites sent (with bonus state) and the ?ref= link. */
export async function GET(request: Request) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Bonuses held for an unconfirmed email settle as soon as either side looks.
    await settleInvitesSentBy(user.id);
    const o = await inviteOverview(user.id);
    const origin = publicOrigin(request);
    return NextResponse.json({ data: { ...o, refLink: refUrl(origin, o.affiliateCode) } });
  } catch (err) {
    console.error('[invites] overview failed', err);
    return NextResponse.json({ error: 'Could not load invites.' }, { status: 500 });
  }
}

/** POST /api/invites { note? }: create one invite. The code is shown once. */
export async function POST(request: Request) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let note = '';
  try {
    const body = (await request.json().catch(() => ({}))) as { note?: unknown } | null;
    if (typeof body?.note === 'string') note = body.note;
  } catch {
    /* empty body is fine */
  }
  try {
    const inv = await createInvite(user.id, note);
    return NextResponse.json(
      {
        data: {
          id: inv.id,
          code: inv.code,
          url: inviteUrl(publicOrigin(request), inv.code),
          expiresAt: inv.expiresAt,
          note: inv.note,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json({ error: err.message, reason: err.reason }, { status: err.status });
    }
    console.error('[invites] create failed', err);
    return NextResponse.json({ error: 'Could not create the invite.' }, { status: 500 });
  }
}
