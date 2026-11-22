import { copilotCheckout } from '@/lib/billing/checkout-pages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/checkout/copilot-credit: the /settings/copilot/add-credit page's
// form. It answers 303 to the CoinPay payment page (or back to the page with
// ?error=<code>). Scripts keep using the JSON route, POST /api/billing/copilot-topup.
export async function POST(request: Request) {
  return copilotCheckout().POST(request);
}
