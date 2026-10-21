/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import {
  availableChains,
  coinpayConfig,
  createCheckoutSession,
  createCryptoPayment,
  createPaypalPayment,
  methodsFor,
  paymentMetadata,
  PAYPAL_METHOD,
  type CheckoutMethod,
  type CoinPayConfig,
} from '@/lib/coinpay-client';
import { upgradePath, type PlanDef } from '@/lib/plans';
import { serviceClient } from '@/lib/supabase/service';

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://pairux.com'
  ).replace(/\/+$/, '');
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export type PlanCheckoutResult =
  | {
      kind: 'redirect';
      rail: 'session' | 'crypto' | 'paypal';
      paymentId: string;
      checkoutUrl: string;
    }
  | { kind: 'choose'; methods: CheckoutMethod[] };

/** The methods the buyer can pick from when CoinPay's hosted session is not available. */
export async function checkoutMethods(cfg: CoinPayConfig | null = coinpayConfig()) {
  return methodsFor(await availableChains(cfg));
}

/**
 * Start a checkout for one term of `plan`.
 *
 * With no `method`, CoinPay's hosted checkout session is tried first (it offers
 * every coin plus PayPal itself); when CoinPay does not offer sessions, the
 * caller gets the list of methods to show its own picker. With a `method`, a
 * crypto payment on that coin, or a PayPal order, is opened directly.
 *
 * Every rail records a pending plan_payments row first-class, so the webhook can
 * resolve user + plan by payment id even if CoinPay drops the metadata.
 */
export async function startPlanCheckout(input: {
  plan: PlanDef;
  userId: string;
  email: string | null;
  method: CheckoutMethod | null;
}): Promise<PlanCheckoutResult> {
  const cfg = coinpayConfig();
  if (!cfg) throw new CheckoutError('Checkout is not configured', 503);

  const base = appBaseUrl();
  const back = `${base}${upgradePath(input.plan.id)}`;
  const successUrl = `${back}?payment=success`;
  const cancelUrl = `${base}/pricing?payment=cancelled`;
  const metadata = paymentMetadata({
    userId: input.userId,
    email: input.email,
    plan: input.plan.id,
    type: 'plan',
  });
  const description = `${input.plan.label}: ${String(input.plan.priceUsd)} USD for 31 days (pairux.com)`;

  let rail: 'session' | 'crypto' | 'paypal';
  let paymentId: string;
  let checkoutUrl: string;
  const rowId = randomUUID();

  if (!input.method) {
    const session = await createCheckoutSession(cfg, {
      amountUsd: input.plan.priceUsd,
      description,
      customerEmail: input.email,
      accountId: input.userId,
      metadata,
      successUrl,
      cancelUrl,
    });
    if (!session) return { kind: 'choose', methods: await checkoutMethods(cfg) };
    rail = 'session';
    paymentId = session.id;
    checkoutUrl = session.url;
  } else if (input.method === PAYPAL_METHOD) {
    const paid = await createPaypalPayment(cfg, {
      amountUsd: input.plan.priceUsd,
      description,
      metadata,
      successUrl,
      cancelUrl,
      invoiceNumber: `pairux-${rowId}`,
      customerEmail: input.email,
    });
    rail = 'paypal';
    paymentId = paid.id;
    checkoutUrl = paid.payUrl;
  } else {
    const paid = await createCryptoPayment(cfg, {
      amountUsd: input.plan.priceUsd,
      chain: input.method,
      description,
      metadata,
      redirectUrl: successUrl,
      cancelUrl: back,
    });
    rail = 'crypto';
    paymentId = paid.id;
    checkoutUrl = paid.payUrl;
  }

  const admin = serviceClient() as any;
  const { error } = await admin.from('plan_payments').insert({
    id: rowId,
    coinpay_payment_id: paymentId,
    user_id: input.userId,
    plan: input.plan.id,
    amount_usd: input.plan.priceUsd,
    currency: input.method ?? 'SESSION',
    status: 'pending',
    metadata: { rail, checkout_url: checkoutUrl, ...metadata },
  });
  if (error) {
    console.error('[billing/checkout] insert failed:', error);
    throw new CheckoutError('Failed to record payment', 500);
  }
  return { kind: 'redirect', rail, paymentId, checkoutUrl };
}
