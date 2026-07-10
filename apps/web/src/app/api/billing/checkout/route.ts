import { z } from 'zod';
import {
  createCoinpayPayment,
  coinpayHostedPayUrl,
  SUPPORTED_CURRENCIES,
  type CoinpayCurrency,
} from '@/lib/coinpay-client';
import { getPlanDef } from '@/lib/plans';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_KEYS = Object.keys(SUPPORTED_CURRENCIES) as [CoinpayCurrency, ...CoinpayCurrency[]];

const Body = z.object({
  plan: z.enum(['plus', 'pro', 'team']),
  // Default to 'card', which routes through CoinPay's card+crypto flow.
  currency: z.enum(SUPPORTED_KEYS).default('card'),
});

// Start a CoinPay invoice to buy/renew the multistream plugin. The CoinPay
// webhook grants the plan on payment.confirmed/forwarded (idempotent on
// payment id), so we only record a pending row here and hand back the
// checkout URL for the client to redirect to.
export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());

    const plan = getPlanDef(body.plan);
    if (!plan) return errorResponse('Unknown plan', 400);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Sign in to upgrade', 401);
    }

    const cp = await createCoinpayPayment({
      amount_usd: plan.priceUsd,
      currency: body.currency,
      description: plan.label,
      metadata: {
        // Read back by the CoinPay webhook to grant the plan to this user.
        type: 'plan',
        user_id: user.id,
        plan: plan.id,
      },
    });

    const payment = cp.payment ?? {};
    const paymentId = cp.payment_id ?? payment.id;
    // Card/Stripe payments return a checkout URL; crypto payments don't, so we
    // fall back to CoinPay's hosted pay page for the created payment id.
    const checkoutUrl =
      payment.stripe_checkout_url ??
      cp.checkout_url ??
      payment.checkout_url ??
      (paymentId ? coinpayHostedPayUrl(paymentId) : null);
    const expiresAt = cp.expires_at ?? payment.expires_at ?? null;

    if (!paymentId) {
      return errorResponse('CoinPay did not return a payment id', 502);
    }

    // Record the pending payment so the webhook can resolve user + plan even
    // if CoinPay drops the metadata on the return trip. Service role bypasses
    // RLS (clients only ever read their own rows).
    const admin = serviceClient() as any;
    const { error: insertError } = await admin.from('plan_payments').insert({
      coinpay_payment_id: paymentId,
      user_id: user.id,
      plan: plan.id,
      amount_usd: plan.priceUsd,
      currency: body.currency,
      status: 'pending',
      metadata: { checkout_url: checkoutUrl, expires_at: expiresAt },
    });
    if (insertError) {
      console.error('[billing/checkout] insert failed:', insertError);
      return errorResponse('Failed to record payment', 500);
    }

    return successResponse({
      payment_id: paymentId,
      checkout_url: checkoutUrl,
      plan: plan.id,
      amount_usd: plan.priceUsd,
      expires_at: expiresAt,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
