import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availableChains,
  coinpayConfig,
  createCheckoutSession,
  createCryptoPayment,
  createPaypalPayment,
  FALLBACK_CHAINS,
  markChainRefused,
  methodsFor,
  normalizeMethod,
  paymentMetadata,
  readCoinpayWebhook,
  resetCoinpayCaches,
} from './coinpay-client';

const cfg = coinpayConfig({
  COINPAY_API_KEY: 'cp_live_test',
  COINPAY_MERCHANT_ID: 'biz-1',
} as unknown as NodeJS.ProcessEnv)!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  resetCoinpayCaches();
  vi.restoreAllMocks();
});

describe('coinpay client', () => {
  it('reads the business id from COINPAY_MERCHANT_ID and builds both URLs', () => {
    expect(cfg).toEqual({
      apiUrl: 'https://coinpayportal.com/api',
      siteUrl: 'https://coinpayportal.com',
      apiKey: 'cp_live_test',
      businessId: 'biz-1',
    });
    expect(coinpayConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('tags every payment with the property, account and email', () => {
    expect(paymentMetadata({ userId: 'u1', email: ' a@b.co ', plan: 'pro', type: 'plan' })).toEqual(
      {
        property: 'pairux.com',
        account_id: 'u1',
        user_id: 'u1',
        type: 'plan',
        plan: 'pro',
        email: 'a@b.co',
        customer_email: 'a@b.co',
      }
    );
    expect(paymentMetadata({ userId: 'u1', plan: 'pro', type: 'plan' })).not.toHaveProperty(
      'email'
    );
  });

  it('knows every coin plus PayPal, refuses anything else, and never offers card', () => {
    expect(normalizeMethod('paypal')).toBe('PAYPAL');
    expect(normalizeMethod('doge')).toBe('DOGE');
    expect(normalizeMethod('card')).toBeNull();
    expect(normalizeMethod('SHIB')).toBeNull();
    for (const c of ['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB', 'USDT_POL']) {
      expect(FALLBACK_CHAINS).toContain(c);
    }
    // Listed by CoinPay, refused at create.
    expect(FALLBACK_CHAINS).not.toContain('USDC_BASE');
    expect(FALLBACK_CHAINS).not.toContain('USDT_TRON');
  });

  it('offers what CoinPay reports active, PayPal second, and falls back when it cannot answer', async () => {
    const ok = vi.fn(async () =>
      json({
        coins: [
          { symbol: 'BTC', is_active: true },
          { symbol: 'USDC_POL', is_active: true },
          { symbol: 'XRP', is_active: false },
          { symbol: 'SHIB', is_active: true },
        ],
      })
    );
    const chains = await availableChains(cfg, ok as unknown as typeof fetch, 1000);
    expect(chains).toEqual(['USDC_POL', 'BTC']);
    expect(methodsFor(chains)).toEqual(['USDC_POL', 'PAYPAL', 'BTC']);
    await availableChains(cfg, ok as unknown as typeof fetch, 2000);
    expect(ok).toHaveBeenCalledOnce();
    markChainRefused('BTC', 2000);
    expect(await availableChains(cfg, ok as unknown as typeof fetch, 3000)).toEqual(['USDC_POL']);
    expect(await availableChains(cfg, ok as unknown as typeof fetch, 2000 + 3_600_001)).toEqual([
      'USDC_POL',
      'BTC',
    ]);
    resetCoinpayCaches();
    const down = (async () => json({}, 502)) as unknown as typeof fetch;
    expect(await availableChains(cfg, down)).toEqual([...FALLBACK_CHAINS]);
  });

  it('uses a hosted checkout session when CoinPay has one, and remembers a 404', async () => {
    const opts = {
      amountUsd: 12,
      description: 'Pro',
      customerEmail: 'a@b.co',
      accountId: 'u1',
      metadata: { property: 'pairux.com' },
      successUrl: 'https://pairux.com/upgrade/pro?payment=success',
      cancelUrl: 'https://pairux.com/pricing',
    };
    const live = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        amount: 12,
        currency: 'USD',
        customer_email: 'a@b.co',
        account_id: 'u1',
        property: 'pairux.com',
        expires_in_minutes: 60,
      });
      return json({ id: 'cs_1', url: 'https://coinpayportal.com/checkout/cs_1' }, 201);
    });
    expect(await createCheckoutSession(cfg, opts, live as unknown as typeof fetch)).toEqual({
      id: 'cs_1',
      url: 'https://coinpayportal.com/checkout/cs_1',
    });

    const missing = vi.fn(async () => json({ error: 'not found' }, 404));
    expect(
      await createCheckoutSession(cfg, opts, missing as unknown as typeof fetch, 0)
    ).toBeNull();
    expect(
      await createCheckoutSession(cfg, opts, missing as unknown as typeof fetch, 1000)
    ).toBeNull();
    expect(missing).toHaveBeenCalledOnce();
  });

  it('opens a crypto payment on the picked coin and a PayPal order', async () => {
    const crypto = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toMatchObject({
        business_id: 'biz-1',
        amount: 12,
        currency: 'USD',
        blockchain: 'BTC',
        metadata: { property: 'pairux.com' },
      });
      return json({ success: true, payment: { id: 'pay_1' } });
    });
    expect(
      await createCryptoPayment(
        cfg,
        {
          amountUsd: 12,
          chain: 'BTC',
          description: 'Pro',
          metadata: { property: 'pairux.com' },
          redirectUrl: 'r',
          cancelUrl: 'c',
        },
        crypto as unknown as typeof fetch
      )
    ).toEqual({ id: 'pay_1', payUrl: 'https://coinpayportal.com/pay/pay_1' });

    const paypal = vi.fn(async (url: string) => {
      expect(url).toBe('https://coinpayportal.com/api/paypal/payments/create');
      return json({ transaction_id: 'pp_1' });
    });
    expect(
      await createPaypalPayment(
        cfg,
        {
          amountUsd: 12,
          description: 'Pro',
          metadata: {},
          successUrl: 's',
          cancelUrl: 'c',
          invoiceNumber: 'pairux-1',
          customerEmail: 'a@b.co',
        },
        paypal as unknown as typeof fetch
      )
    ).toEqual({ id: 'pp_1', payUrl: 'https://coinpayportal.com/pay/paypal/pp_1' });

    const refused = (async () => json({ error: 'No BTC wallet' }, 400)) as unknown as typeof fetch;
    await expect(
      createCryptoPayment(
        cfg,
        {
          amountUsd: 1,
          chain: 'BTC',
          description: '',
          metadata: {},
          redirectUrl: '',
          cancelUrl: '',
        },
        refused
      )
    ).rejects.toMatchObject({ status: 400, message: 'No BTC wallet' });
  });

  it('reads crypto, PayPal and session webhooks into one shape', () => {
    expect(
      readCoinpayWebhook({
        id: 'evt',
        type: 'payment.confirmed',
        data: {
          payment_id: 'pay_1',
          status: 'confirmed',
          amount_usd: '12',
          metadata: { plan: 'pro' },
        },
      })
    ).toMatchObject({ paymentId: 'pay_1', status: 'confirmed', settled: true, amountUsd: 12 });
    expect(
      readCoinpayWebhook({
        type: 'payment.forwarded',
        data: { payment_id: 'pay_1', checkout_session_id: 'cs_1' },
      })
    ).toMatchObject({ paymentId: 'pay_1', sessionId: 'cs_1', status: 'forwarded', settled: true });
    expect(
      readCoinpayWebhook({
        type: 'payment.detected',
        data: { payment_id: 'p', status: 'detected' },
      })
    ).toMatchObject({ settled: false, status: 'detected' });
    expect(
      readCoinpayWebhook({ type: 'payment.expired', data: { payment_id: 'p' } })
    ).toMatchObject({
      status: 'expired',
      settled: false,
    });
  });
});
