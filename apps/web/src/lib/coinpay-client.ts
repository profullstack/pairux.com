/**
 * CoinPay (coinpayportal.com) client: the only payment processor for PairUX.
 *
 * Server-only. CoinPay is invoice-based: each payment buys one subscription
 * period (see lib/plans.ts). The webhook grants/extends the plan on a settled
 * payment, keyed by payment id for idempotency.
 *
 * Three rails, tried in this order:
 *  1. CoinPay hosted checkout sessions (POST /api/checkout/sessions): CoinPay's
 *     own page offers every coin plus PayPal. Feature-detected: while CoinPay
 *     answers 404/405 there, we fall back to 2 and 3.
 *  2. A crypto payment on the coin the buyer picked (POST /api/payments/create).
 *  3. PayPal through CoinPay's PayPal rail (POST /api/paypal/payments/create).
 *
 * No card rail: CoinPay's card method is Stripe, which we do not use.
 *
 * The payee is never sent: CoinPay resolves it from the business's own
 * wallets, so every coin offered must be one the business holds a wallet for.
 * What we offer is narrowed to GET /api/supported-coins for the business.
 *
 * Modelled on smshub src/lib/coinpay/checkout.ts.
 */

const DEFAULT_COINPAY_URL = 'https://coinpayportal.com';

/** Every payment carries this, so CoinPay rows map back to the site and account. */
export const PAYMENT_PROPERTY = 'pairux.com';

/** How long a checkout stays open. Stablecoins carry no price risk over it. */
export const CHECKOUT_WINDOW_MINUTES = 60;

/**
 * Every coin CoinPay can take a payment in, stablecoins first, cheapest to send
 * first. The buyer sees this narrowed to what CoinPay reports active for the
 * business right now (see availableChains).
 */
export const CHECKOUT_CHAINS = [
  'USDC_POL',
  'USDC_SOL',
  'USDC_BASE',
  'USDT_POL',
  'USDT_SOL',
  'USDT_TRON',
  'USDC_ETH',
  'USDT_ETH',
  'POL',
  'SOL',
  'ETH',
  'BTC',
  'BCH',
  'DOGE',
  'XRP',
  'ADA',
  'BNB',
] as const;
export type CheckoutChain = (typeof CHECKOUT_CHAINS)[number];

/**
 * Listed by CoinPay but refused at create time, so never offered:
 * USDT_TRON is off until CoinPay has TRON wallets, and USDC_BASE answers
 * "400 Unsupported blockchain for fee estimation: BASE" (2026-10-21).
 */
const NOT_OFFERED: ReadonlySet<CheckoutChain> = new Set(['USDT_TRON', 'USDC_BASE']);

/** Offered when CoinPay cannot be asked: the coins the business was last seen to accept. */
export const FALLBACK_CHAINS: readonly CheckoutChain[] = CHECKOUT_CHAINS.filter(
  (c) => !NOT_OFFERED.has(c)
);
export const DEFAULT_CHAIN: CheckoutChain = 'USDC_POL';

/** PayPal through CoinPay (the pairux business is connected self-serve). */
export const PAYPAL_METHOD = 'PAYPAL' as const;
export type CheckoutMethod = CheckoutChain | typeof PAYPAL_METHOD;

/** Buyer-facing labels for the picker. */
export const METHOD_LABELS: Record<CheckoutMethod, string> = {
  PAYPAL: 'PayPal or card (via PayPal)',
  USDC_POL: 'USDC on Polygon',
  USDC_SOL: 'USDC on Solana',
  USDC_BASE: 'USDC on Base',
  USDT_POL: 'USDT on Polygon',
  USDT_SOL: 'USDT on Solana',
  USDT_TRON: 'USDT on TRON',
  USDC_ETH: 'USDC on Ethereum',
  USDT_ETH: 'USDT on Ethereum',
  POL: 'Polygon (POL)',
  SOL: 'Solana (SOL)',
  ETH: 'Ethereum (ETH)',
  BTC: 'Bitcoin (BTC)',
  BCH: 'Bitcoin Cash (BCH)',
  DOGE: 'Dogecoin (DOGE)',
  XRP: 'XRP',
  ADA: 'Cardano (ADA)',
  BNB: 'BNB',
};

/** A scalar from untrusted JSON as text; objects and arrays read as ''. */
export function asText(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}

/** An unknown or misspelled method is refused (null) rather than reaching CoinPay. */
export function normalizeMethod(method: unknown): CheckoutMethod | null {
  const m = asText(method).trim().toUpperCase();
  if (m === PAYPAL_METHOD) return PAYPAL_METHOD;
  return (CHECKOUT_CHAINS as readonly string[]).includes(m) ? (m as CheckoutChain) : null;
}

/** The default coin, PayPal, then the other live coins. */
export function methodsFor(chains: readonly CheckoutChain[]): CheckoutMethod[] {
  const first = chains.includes(DEFAULT_CHAIN) ? [DEFAULT_CHAIN] : [];
  return [...first, PAYPAL_METHOD, ...chains.filter((c) => c !== DEFAULT_CHAIN)];
}

export interface CoinPayConfig {
  /** Ends in /api. */
  apiUrl: string;
  /** Without /api, for hosted pages. */
  siteUrl: string;
  apiKey: string;
  businessId: string;
}

export function coinpayConfig(env: NodeJS.ProcessEnv = process.env): CoinPayConfig | null {
  const apiKey = env.COINPAY_API_KEY ?? '';
  const businessId = env.COINPAY_MERCHANT_ID ?? env.COINPAY_BUSINESS_ID ?? '';
  if (!apiKey || !businessId) return null;
  const siteUrl = (env.COINPAY_API_URL ?? DEFAULT_COINPAY_URL)
    .replace(/\/+$/, '')
    .replace(/\/api$/, '');
  return { apiUrl: `${siteUrl}/api`, siteUrl, apiKey, businessId };
}

export class CoinPayError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Every payment's metadata: the site, the account, the buyer's email and what was bought. */
export function paymentMetadata(input: {
  userId: string;
  email?: string | null;
  plan: string;
  type: string;
}): Record<string, string> {
  const meta: Record<string, string> = {
    property: PAYMENT_PROPERTY,
    account_id: input.userId,
    user_id: input.userId,
    type: input.type,
    plan: input.plan,
  };
  const email = (input.email ?? '').trim();
  if (email) {
    meta.email = email;
    meta.customer_email = email;
  }
  return meta;
}

// ---------------------------------------------------------------- coins

let chainsCache: { at: number; chains: CheckoutChain[] } | null = null;
const CHAINS_TTL_MS = 10 * 60_000;

/** Coins CoinPay refused at create time, hidden for an hour: its list and its create disagree. */
const refusedUntil = new Map<CheckoutChain, number>();
const REFUSED_TTL_MS = 60 * 60_000;

export function markChainRefused(chain: CheckoutChain, nowMs: number = Date.now()): void {
  refusedUntil.set(chain, nowMs + REFUSED_TTL_MS);
}

function offered(chains: readonly CheckoutChain[], nowMs: number): CheckoutChain[] {
  return chains.filter((c) => !NOT_OFFERED.has(c) && (refusedUntil.get(c) ?? 0) <= nowMs);
}

/**
 * The coins CoinPay reports active for the business, kept to the ones we know,
 * in our order. Any failure answers FALLBACK_CHAINS: a coin that was just
 * switched off fails at create time with a clear error, which beats offering
 * nothing.
 */
export async function availableChains(
  cfg: CoinPayConfig | null,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now()
): Promise<CheckoutChain[]> {
  if (!cfg) return offered(FALLBACK_CHAINS, nowMs);
  if (chainsCache && nowMs - chainsCache.at < CHAINS_TTL_MS)
    return offered(chainsCache.chains, nowMs);
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/supported-coins?active_only=true`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as {
      coins?: { symbol?: string; is_active?: boolean }[];
    };
    const active = new Set(
      (body.coins ?? [])
        .filter((c) => c.is_active !== false)
        .map((c) => (c.symbol ?? '').toUpperCase())
    );
    const chains = CHECKOUT_CHAINS.filter((c) => active.has(c));
    if (!res.ok || chains.length === 0) return offered(FALLBACK_CHAINS, nowMs);
    chainsCache = { at: nowMs, chains };
    return offered(chains, nowMs);
  } catch {
    return offered(FALLBACK_CHAINS, nowMs);
  }
}

// ---------------------------------------------------- hosted sessions

let sessionsUnsupportedUntil = 0;
const SESSIONS_RETRY_MS = 10 * 60_000;

/** Test hook. */
export function resetCoinpayCaches(): void {
  chainsCache = null;
  sessionsUnsupportedUntil = 0;
  refusedUntil.clear();
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * Open a CoinPay hosted checkout session (every coin plus PayPal on CoinPay's
 * own page). Returns null when CoinPay does not offer sessions yet (404/405,
 * remembered for 10 minutes) or the call fails, so the caller falls back to
 * its own coin picker.
 */
export async function createCheckoutSession(
  cfg: CoinPayConfig,
  opts: {
    amountUsd: number;
    description: string;
    customerEmail?: string | null;
    accountId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now()
): Promise<CheckoutSession | null> {
  if (nowMs < sessionsUnsupportedUntil) return null;
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        business_id: cfg.businessId,
        amount: opts.amountUsd,
        currency: 'USD',
        description: opts.description,
        customer_email: opts.customerEmail ?? undefined,
        account_id: opts.accountId,
        property: PAYMENT_PROPERTY,
        metadata: opts.metadata,
        success_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
        expires_in_minutes: CHECKOUT_WINDOW_MINUTES,
      }),
    });
    if (res.status === 404 || res.status === 405) {
      sessionsUnsupportedUntil = nowMs + SESSIONS_RETRY_MS;
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      session?: { id?: string; url?: string };
      error?: string;
    };
    const id = body.id ?? body.session?.id;
    const url = body.url ?? body.session?.url;
    if (!res.ok || !id || !url) {
      console.error(
        `[coinpay] checkout session failed ${String(res.status)}: ${body.error ?? 'no id/url'}`
      );
      return null;
    }
    return { id, url };
  } catch (error) {
    console.error('[coinpay] checkout session failed:', error);
    return null;
  }
}

// ------------------------------------------------------ direct rails

export interface CreatedPayment {
  id: string;
  payUrl: string;
}

export async function createCryptoPayment(
  cfg: CoinPayConfig,
  opts: {
    amountUsd: number;
    chain: CheckoutChain;
    description: string;
    metadata: Record<string, string>;
    redirectUrl: string;
    cancelUrl: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<CreatedPayment> {
  const res = await fetchImpl(`${cfg.apiUrl}/payments/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      business_id: cfg.businessId,
      amount: opts.amountUsd,
      currency: 'USD',
      blockchain: opts.chain,
      description: opts.description,
      metadata: opts.metadata,
      redirect_url: opts.redirectUrl,
      cancel_url: opts.cancelUrl,
      expires_in_minutes: CHECKOUT_WINDOW_MINUTES,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    payment_id?: string;
    payment?: { id?: string };
  };
  const id = body.payment?.id ?? body.payment_id;
  if (!res.ok || !id) {
    throw new CoinPayError(body.error ?? `CoinPay answered ${String(res.status)}`, res.status);
  }
  return { id, payUrl: `${cfg.siteUrl}/pay/${id}` };
}

/**
 * PayPal through CoinPay. `amount` is major units (dollars). The returned id is
 * CoinPay's PayPal transaction id, which is also the `payment_id` of the
 * payment.confirmed webhook on capture, so settlement needs nothing
 * PayPal-specific. The hosted page also offers PayPal's guest card checkout.
 */
export async function createPaypalPayment(
  cfg: CoinPayConfig,
  opts: {
    amountUsd: number;
    description: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    invoiceNumber: string;
    customerEmail?: string | null;
  },
  fetchImpl: typeof fetch = fetch
): Promise<CreatedPayment> {
  const res = await fetchImpl(`${cfg.apiUrl}/paypal/payments/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      business_id: cfg.businessId,
      amount: opts.amountUsd,
      currency: 'USD',
      description: opts.description,
      metadata: opts.metadata,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      invoiceNumber: opts.invoiceNumber,
      customer_email: opts.customerEmail ?? undefined,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; transaction_id?: string };
  const id = body.transaction_id;
  if (!res.ok || !id) {
    throw new CoinPayError(
      body.error ?? `CoinPay PayPal answered ${String(res.status)}`,
      res.status
    );
  }
  // Built from our own config rather than trusted from the response.
  return { id, payUrl: `${cfg.siteUrl}/pay/paypal/${id}` };
}

// ------------------------------------------------------------ webhook

/**
 * Statuses that mean the money arrived. Never `detected`, which fires before
 * confirmations.
 */
const SETTLED_STATUSES = new Set([
  'confirmed',
  'forwarded',
  'paid',
  'completed',
  'succeeded',
  'settled',
]);
const SETTLED_EVENTS = new Set([
  'payment.confirmed',
  'payment.completed',
  'payment.forwarded',
  'checkout.session.completed',
]);

export interface CoinpayWebhookEvent {
  eventType: string;
  paymentId: string | null;
  sessionId: string | null;
  /** 'confirmed' | 'forwarded' | 'expired' | 'failed' | other, for plan_payments.status */
  status: string;
  settled: boolean;
  txHash: string | null;
  amountUsd: number | null;
  metadata: Record<string, unknown>;
}

/** CoinPay nests the payment under `data`; the top-level `id` is the EVENT id. */
export function readCoinpayWebhook(payload: unknown): CoinpayWebhookEvent {
  const p = (payload ?? {}) as Record<string, unknown>;
  const d = (p.data && typeof p.data === 'object' ? p.data : p) as Record<string, unknown>;
  const eventType = asText(p.type) || asText(p.event);
  const str = (v: unknown): string | null => asText(v) || null;
  const sessionId = str(d.checkout_session_id ?? p.checkout_session_id);
  const paymentId = str(d.payment_id ?? (p.data ? d.id : null));
  let status = asText(d.status).toLowerCase();
  if (!status || !SETTLED_STATUSES.has(status)) {
    if (eventType === 'payment.forwarded') status = 'forwarded';
    else if (SETTLED_EVENTS.has(eventType)) status = 'confirmed';
    else if (eventType === 'payment.expired') status = 'expired';
    else if (eventType === 'payment.failed') status = 'failed';
  }
  if (status === 'paid' || status === 'completed' || status === 'succeeded' || status === 'settled')
    status = 'confirmed';
  const amount = Number(d.amount_usd ?? d.amount);
  const metadata = (d.metadata ?? p.metadata ?? {}) as Record<string, unknown>;
  return {
    eventType,
    paymentId,
    sessionId,
    status,
    settled: status === 'confirmed' || status === 'forwarded',
    txHash: str(d.tx_hash ?? d.merchant_tx_hash),
    amountUsd: Number.isFinite(amount) && amount > 0 ? amount : null,
    metadata: typeof metadata === 'object' ? metadata : {},
  };
}
