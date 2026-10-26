import { NextResponse } from 'next/server';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { requestUser } from '@/lib/request-user';
import { INVITE_BONUS_PRO_DAYS, INVITE_COOKIE, acceptInvite } from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const attemptsByUser = new FixedWindowRateLimiter(10, 10 * 60_000);

/**
 * POST /api/invites/accept  { code: "INV-XXXX-XXXX-XXXX" }
 *
 * Join on an invite (accounts up to a week old, once). Both people get
 * INVITE_BONUS_PRO_DAYS of Pro once the new account's email is confirmed:
 * `bonus` is "granted", "pending" or "denied".
 */
export async function POST(request: Request) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = attemptsByUser.check(user.id);
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let code: unknown;
  try {
    code = ((await request.json()) as { code?: unknown } | null)?.code;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof code !== 'string' || !code.trim() || code.length > 64) {
    return NextResponse.json(
      { error: 'Enter an invite code.', reason: 'invalid' },
      { status: 400 }
    );
  }

  try {
    const r = await acceptInvite(user.id, code);
    if (!r.ok) return NextResponse.json({ error: r.message, reason: r.reason }, { status: 400 });
    const message =
      r.bonus === 'granted'
        ? `Invite accepted. You both got ${String(INVITE_BONUS_PRO_DAYS)} days of Pro.`
        : r.bonus === 'pending'
          ? 'Invite accepted. Your Pro days arrive once your email is confirmed.'
          : 'Invite accepted.';
    const res = NextResponse.json({
      data: { ok: true, bonus: r.bonus, bonusDays: INVITE_BONUS_PRO_DAYS, message },
    });
    res.cookies.delete(INVITE_COOKIE);
    return res;
  } catch (err) {
    console.error('[invites/accept] failed:', err);
    return NextResponse.json({ error: 'Could not accept the invite. Try again.' }, { status: 500 });
  }
}
