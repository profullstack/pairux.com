import { NextResponse } from 'next/server';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { requestUser } from '@/lib/request-user';
import { redeemCreditCode } from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Codes carry 80 random bits, but there is no reason to let anyone guess fast.
const attemptsByUser = new FixedWindowRateLimiter(10, 10 * 60_000);

/**
 * POST /api/credits/redeem  { code: "CR-XXXX-XXXX-XXXX-XXXX" }
 *
 * Redeem a credit code: it adds days of a paid plan (Pro unless the code says
 * otherwise) to profiles.plan / plan_expires_at, the same columns a payment
 * extends. Web cookie, desktop/mobile Bearer or `pairux redeem`.
 */
export async function POST(request: Request) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = attemptsByUser.check(user.id);
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  let code: unknown;
  try {
    code = ((await request.json()) as { code?: unknown } | null)?.code;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof code !== 'string' || !code.trim() || code.length > 64) {
    return NextResponse.json({ error: 'Enter a code.', reason: 'invalid' }, { status: 400 });
  }

  try {
    const r = await redeemCreditCode(user.id, code);
    if (!r.ok) return NextResponse.json({ error: r.message, reason: r.reason }, { status: 400 });
    const name = `${r.plan.charAt(0).toUpperCase()}${r.plan.slice(1)}`;
    return NextResponse.json({
      data: {
        ok: true,
        plan: r.plan,
        days: r.days,
        effectivePlan: r.view.effectivePlan,
        planExpiresAt: r.view.planExpiresAt,
        message: `Code redeemed: ${String(r.days)} days of PairUX ${name}.`,
      },
    });
  } catch (err) {
    console.error('[credits/redeem] failed:', err);
    return NextResponse.json({ error: 'Could not redeem the code. Try again.' }, { status: 500 });
  }
}
