import { NextResponse } from 'next/server';
import { requestUser } from '@/lib/request-user';
import { getCreditDeps, planView } from '@/lib/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/credits: the caller's plan, its end date and the grants codes/invites gave. */
export async function GET(request: Request) {
  const user = await requestUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const d = getCreditDeps();
    const [view, history] = await Promise.all([
      planView(d.db, user.id),
      d.credits.history(user.id),
    ]);
    return NextResponse.json({
      data: {
        ...view,
        grants: history
          .filter((e) => e.kind === 'grant')
          .map((e) => ({
            unit: e.unit,
            amount: e.amount,
            source: e.source,
            at: new Date(e.at).toISOString(),
          })),
      },
    });
  } catch (err) {
    console.error('[credits] overview failed', err);
    return NextResponse.json({ error: 'Could not load your plan.' }, { status: 500 });
  }
}
