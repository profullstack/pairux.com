import { NextResponse } from 'next/server';
import { isAdminUser, requestUser } from '@/lib/request-user';
import { getCreditDeps, mintCreditCode, planForUnit, type PaidPlan } from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function admin(request: Request) {
  const user = await requestUser(request);
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!(await isAdminUser(user.id))) {
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

/** GET /api/admin/credit-codes: every minted code (never the code itself, only its hash is stored). */
export async function GET(request: Request) {
  const a = await admin(request);
  if (a.res) return a.res;
  const codes = await getCreditDeps().credits.list();
  return NextResponse.json({
    data: codes.map((c) => ({ ...c, plan: planForUnit(c.grant.unit), days: c.grant.amount })),
  });
}

/**
 * POST /api/admin/credit-codes { days, plan?: plus|pro|team (default pro), label?, maxRedemptions?, expiresInDays? }
 * Returns the plaintext code once.
 */
export async function POST(request: Request) {
  const a = await admin(request);
  if (a.res) return a.res;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const plan = (typeof body.plan === 'string' ? body.plan : 'pro') as PaidPlan;
  const expiresInDays = Number(body.expiresInDays ?? 0);
  try {
    const minted = await mintCreditCode({
      days: Number(body.days),
      plan,
      label: typeof body.label === 'string' ? body.label : undefined,
      maxRedemptions: body.maxRedemptions === undefined ? 1 : Number(body.maxRedemptions),
      expiresAt: expiresInDays > 0 ? Date.now() + expiresInDays * 86_400_000 : null,
      createdBy: a.user.id,
    });
    return NextResponse.json(
      { data: { ...minted, plan, days: minted.grant.amount } },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof TypeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[admin/credit-codes] mint failed', err);
    return NextResponse.json({ error: 'Could not mint the code.' }, { status: 500 });
  }
}
