/**
 * CoinPay (coinpayportal.com) client — the only payment processor for PairUX.
 *
 * Server-only. CoinPay is invoice-based: each payment buys one subscription
 * period (see lib/plans.ts). The webhook grants/extends the plan on
 * payment.confirmed/forwarded, keyed by payment id for idempotency.
 *
 * Ported from the bl0ggers integration to keep one house pattern.
 */

const COINPAY_BASE_URL = 'https://coinpayportal.com';
const COINPAY_API_URL = `${COINPAY_BASE_URL}/api`;

/**
 * CoinPay's hosted payment page for a payment id. Crypto payments don't return
 * a checkout_url (unlike card/Stripe), so we redirect the buyer here to see the
 * address + amount and complete payment.
 */
export function coinpayHostedPayUrl(paymentId: string): string {
  return `${COINPAY_BASE_URL}/pay/${paymentId}`;
}

export type CoinpayCurrency =
  | 'card'
  | 'usdc_pol'
  | 'usdc_sol'
  | 'usdc_eth'
  | 'usdt'
  | 'pol'
  | 'sol'
  | 'btc'
  | 'eth';

export const SUPPORTED_CURRENCIES: Record<CoinpayCurrency, { name: string; symbol: string }> = {
  card: { name: 'Credit / Debit Card', symbol: 'Card' },
  usdc_pol: { name: 'USDC (Polygon)', symbol: 'USDC' },
  usdc_sol: { name: 'USDC (Solana)', symbol: 'USDC' },
  usdc_eth: { name: 'USDC (Ethereum)', symbol: 'USDC' },
  usdt: { name: 'USDT', symbol: 'USDT' },
  pol: { name: 'Polygon', symbol: 'POL' },
  sol: { name: 'Solana', symbol: 'SOL' },
  btc: { name: 'Bitcoin', symbol: 'BTC' },
  eth: { name: 'Ethereum', symbol: 'ETH' },
};

export interface CoinpayCreatePaymentResponse {
  success?: boolean;
  payment_id?: string;
  address?: string;
  amount_crypto?: number;
  currency?: string;
  expires_at?: string;
  checkout_url?: string;
  payment?: {
    id?: string;
    payment_address?: string;
    amount_crypto?: number;
    crypto_amount?: number;
    currency?: string;
    expires_at?: string;
    checkout_url?: string;
    stripe_checkout_url?: string;
    stripe_session_id?: string;
    [key: string]: unknown;
  };
}

// Known CoinPay event types. The webhook tolerates unknown values (type is a
// plain string), but these document the ones we act on.
export type CoinpayEventType =
  | 'payment.confirmed'
  | 'payment.forwarded'
  | 'payment.expired'
  | 'payment.failed';

export interface CoinpayWebhookPayload {
  id: string;
  type: string;
  data: {
    payment_id: string;
    status: string;
    amount_crypto?: string | number;
    amount_usd?: string | number;
    currency?: string;
    payment_address?: string;
    tx_hash?: string;
    merchant_tx_hash?: string;
    metadata?: Record<string, unknown>;
  };
  created_at?: string;
  business_id?: string;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://pairux.com'
  );
}

function getCreds(): { apiKey: string; merchantId: string } {
  const apiKey = process.env.COINPAY_API_KEY;
  const merchantId = process.env.COINPAY_MERCHANT_ID;
  if (!apiKey || !merchantId) {
    throw new Error('CoinPay credentials not configured');
  }
  return { apiKey, merchantId };
}

export async function createCoinpayPayment(opts: {
  amount_usd: number;
  currency: CoinpayCurrency;
  description?: string;
  redirect_url?: string;
  metadata?: Record<string, unknown>;
}): Promise<CoinpayCreatePaymentResponse> {
  const { apiKey, merchantId } = getCreds();
  const baseUrl = appBaseUrl();
  const res = await fetch(`${COINPAY_API_URL}/payments/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
    body: JSON.stringify({
      business_id: merchantId,
      amount_usd: opts.amount_usd,
      // For card payments CoinPay still requires a currency. We use
      // payment_method=both and redirect the user to stripe_checkout_url.
      ...(opts.currency === 'card'
        ? { payment_method: 'both', currency: 'usdc_pol' }
        : { payment_method: 'crypto', currency: opts.currency }),
      description: opts.description ?? 'PairUX multistream plugin',
      success_url: `${baseUrl}/pricing?payment=success`,
      cancel_url: `${baseUrl}/pricing?payment=cancelled`,
      redirect_url: opts.redirect_url ?? `${baseUrl}/pricing?payment=success`,
      webhook_url: `${baseUrl}/api/webhooks/coinpay`,
      metadata: { type: 'plan', ...(opts.metadata ?? {}) },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[coinpay] create failed ${String(res.status)}: ${text}`);
    throw new Error(`CoinPay create failed ${String(res.status)}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as CoinpayCreatePaymentResponse;
  return json;
}

export async function getCoinpayPaymentStatus(paymentId: string): Promise<{
  status: string;
  tx_hash?: string | null;
}> {
  const { apiKey } = getCreds();
  const res = await fetch(`${COINPAY_API_URL}/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`CoinPay status failed: ${String(res.status)}`);
  }
  const json = (await res.json()) as {
    payment?: { status?: string; tx_hash?: string | null };
    status?: string;
  };
  const status = json.payment?.status ?? json.status ?? 'pending';
  return { status, tx_hash: json.payment?.tx_hash ?? null };
}
