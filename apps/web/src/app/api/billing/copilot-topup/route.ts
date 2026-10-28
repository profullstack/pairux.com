import { z } from 'zod';
import { CoinPayError, METHOD_LABELS, normalizeMethod } from '@/lib/coinpay-client';
import { CheckoutError, startPlanCheckout } from '@/lib/billing/plan-checkout';
import { copilotTopup } from '@/lib/copilot/pricing';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  topup: z.enum(['copilot_credit_5', 'copilot_credit_20', 'copilot_credit_50']),
  /** A coin (USDC_POL, BTC, ...) or PAYPAL. Omitted: CoinPay's hosted checkout, if offered. */
  method: z.string().optional(),
});

// POST /api/billing/copilot-topup — prepaid AI copilot credit for pay-as-you-go
// cloud models. The CoinPay webhook adds it to copilot_wallets once settled.
export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const topup = copilotTopup(body.topup);
    if (!topup) return errorResponse('Unknown top-up', 400);
    let method = null;
    if (body.method) {
      method = normalizeMethod(body.method);
      if (!method) return errorResponse('Unsupported payment method', 400);
    }
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Sign in to add copilot credit', 401);

    const result = await startPlanCheckout({
      plan: { id: topup.id, label: 'PairUX AI copilot credit', priceUsd: topup.priceUsd },
      userId: user.id,
      email: user.email ?? null,
      method,
      description: `PairUX AI copilot credit: ${String(topup.priceUsd)} USD (pay as you go, pairux.com)`,
      returnPath: '/settings/copilot',
      type: 'copilot_credit',
    });
    if (result.kind === 'choose')
      return successResponse({
        choose_method: true,
        topup: topup.id,
        amount_usd: topup.priceUsd,
        methods: result.methods.map((id) => ({ id, label: METHOD_LABELS[id] })),
      });
    return successResponse({
      payment_id: result.paymentId,
      checkout_url: result.checkoutUrl,
      rail: result.rail,
      topup: topup.id,
      amount_usd: topup.priceUsd,
    });
  } catch (error) {
    if (error instanceof CheckoutError) return errorResponse(error.message, error.status);
    if (error instanceof CoinPayError) {
      console.error('[billing/copilot-topup] CoinPay refused:', error.status, error.message);
      return errorResponse(`CoinPay: ${error.message}`, 502);
    }
    return handleApiError(error);
  }
}
