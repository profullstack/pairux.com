import { z } from 'zod';
import { CoinPayError, METHOD_LABELS, normalizeMethod } from '@/lib/coinpay-client';
import { CheckoutError, checkoutMethods, startPlanCheckout } from '@/lib/billing/plan-checkout';
import { getPlanDef } from '@/lib/plans';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  plan: z.enum(['plus', 'pro', 'team']),
  /** A coin (USDC_POL, BTC, ...) or PAYPAL. Omitted: CoinPay's hosted checkout, if offered. */
  method: z.string().optional(),
});

// GET /api/billing/checkout: the payment methods the picker offers.
export async function GET() {
  const methods = await checkoutMethods();
  return successResponse({
    methods: methods.map((id) => ({ id, label: METHOD_LABELS[id] })),
  });
}

// POST /api/billing/checkout: start a CoinPay checkout for one term of a plan.
// The CoinPay webhook grants the plan on a settled payment (idempotent on
// payment id). Answers either a checkout_url to redirect to, or
// choose_method + methods when the buyer must pick a coin or PayPal first.
export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const plan = getPlanDef(body.plan);
    if (!plan) return errorResponse('Unknown plan', 400);

    let method = null;
    if (body.method) {
      method = normalizeMethod(body.method);
      if (!method) return errorResponse('Unsupported payment method', 400);
    }

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Sign in to upgrade', 401);

    const result = await startPlanCheckout({
      plan,
      userId: user.id,
      email: user.email ?? null,
      method,
    });
    if (result.kind === 'choose') {
      return successResponse({
        choose_method: true,
        plan: plan.id,
        amount_usd: plan.priceUsd,
        methods: result.methods.map((id) => ({ id, label: METHOD_LABELS[id] })),
      });
    }
    return successResponse({
      payment_id: result.paymentId,
      checkout_url: result.checkoutUrl,
      rail: result.rail,
      plan: plan.id,
      amount_usd: plan.priceUsd,
    });
  } catch (error) {
    if (error instanceof CheckoutError) return errorResponse(error.message, error.status);
    if (error instanceof CoinPayError) {
      console.error('[billing/checkout] CoinPay refused:', error.status, error.message);
      return errorResponse(`CoinPay: ${error.message}`, 502);
    }
    return handleApiError(error);
  }
}
