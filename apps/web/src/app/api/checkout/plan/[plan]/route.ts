import { planCheckout } from '@/lib/billing/checkout-pages';
import { getPlanDef } from '@/lib/plans';
import { errorResponse } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/checkout/plan/<plan>: the /upgrade/<plan> page's form. It answers
// 303 to the CoinPay payment page (or back to the page with ?error=<code>).
// Scripts and the apps keep using the JSON route, POST /api/billing/checkout.
export async function POST(request: Request, context: { params: Promise<{ plan: string }> }) {
  const { plan } = await context.params;
  const def = getPlanDef(plan);
  if (!def) return errorResponse('Unknown plan', 404);
  return planCheckout(def.id).POST(request);
}
