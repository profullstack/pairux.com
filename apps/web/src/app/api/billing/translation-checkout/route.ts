import { z } from 'zod';
import {
  createCoinpayPayment,
  coinpayHostedPayUrl,
  SUPPORTED_CURRENCIES,
  type CoinpayCurrency,
} from '@/lib/coinpay-client';
import { translationPass } from '@/lib/translation/meter';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_KEYS = Object.keys(SUPPORTED_CURRENCIES) as [CoinpayCurrency, ...CoinpayCurrency[]];
const Body = z.object({
  pass: z.enum(['translation_day', 'translation_month']),
  currency: z.enum(SUPPORTED_KEYS).default('card'),
});

// POST /api/billing/translation-checkout — buy prepaid meeting-translation
// credit (Day $1 / Month $5). The CoinPay webhook credits it once, atomically
// (translation_credit_payment), on confirmed/forwarded.
export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const pass = translationPass(body.pass);
    if (!pass) return errorResponse('Unknown pass', 400);

    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Sign in to buy a translation pass', 401);

    const cp = await createCoinpayPayment({
      amount_usd: pass.priceUsd,
      currency: body.currency,
      description: `PairUX meeting translation: ${pass.name}`,
      metadata: { type: 'translation', user_id: user.id, plan: pass.id },
    });
    const payment = cp.payment ?? {};
    const paymentId = cp.payment_id ?? payment.id;
    const checkoutUrl =
      payment.stripe_checkout_url ??
      cp.checkout_url ??
      payment.checkout_url ??
      (paymentId ? coinpayHostedPayUrl(paymentId) : null);
    const expiresAt = cp.expires_at ?? payment.expires_at ?? null;
    if (!paymentId) return errorResponse('CoinPay did not return a payment id', 502);

    const admin = serviceClient() as any;
    const { error: insertError } = await admin.from('plan_payments').insert({
      coinpay_payment_id: paymentId,
      user_id: user.id,
      plan: pass.id,
      amount_usd: pass.priceUsd,
      currency: body.currency,
      status: 'pending',
      metadata: { checkout_url: checkoutUrl, expires_at: expiresAt },
    });
    if (insertError) {
      console.error('[billing/translation-checkout] insert failed:', insertError);
      return errorResponse('Failed to record payment', 500);
    }
    return successResponse({
      payment_id: paymentId,
      checkout_url: checkoutUrl,
      pass: pass.id,
      amount_usd: pass.priceUsd,
      expires_at: expiresAt,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
