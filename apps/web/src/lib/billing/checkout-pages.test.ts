import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  rows: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({})),
  getAuthenticatedUser: vi.fn(() => Promise.resolve({ user: auth.user, error: null })),
}));

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        auth.rows.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import { POST as planApi } from '@/app/api/billing/checkout/route';
import { POST as topupApi } from '@/app/api/billing/copilot-topup/route';
import { POST as planForm } from '@/app/api/checkout/plan/[plan]/route';
import { POST as creditForm } from '@/app/api/checkout/copilot-credit/route';
import { resetCoinpayCaches } from '@/lib/coinpay-client';
import { COPILOT_TOPUPS } from '@/lib/copilot/pricing';
import { PLANS, type PaidPlan } from '@/lib/plans';
import { copilotCheckout, planCheckout } from './checkout-pages';

const USER = { id: 'user-1', email: 'buyer@example.com' };
const PLAN_IDS: PaidPlan[] = ['plus', 'pro', 'team'];

/** Every CoinPay session request body sent, in order. */
let sessions: Record<string, unknown>[];
let sessionStatus: number;

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(url: string, fields: Record<string, string>, headers = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

/** What the plan_payments insert recorded, without the per-payment row id. */
function lastRow(): Record<string, unknown> {
  const { id: _id, ...row } = auth.rows.at(-1) ?? {};
  return row;
}

beforeEach(() => {
  auth.user = USER;
  auth.rows = [];
  sessions = [];
  sessionStatus = 200;
  vi.stubEnv('COINPAY_API_KEY', 'cp_live_test');
  vi.stubEnv('COINPAY_MERCHANT_ID', 'biz-1');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pairux.com');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/checkout/sessions')) {
        sessions.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        if (sessionStatus !== 200) return Promise.resolve(new Response('{}', { status: 404 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 'cs_test', url: 'https://coinpayportal.com/checkout/cs_test' })
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ coins: [] })));
    })
  );
});

afterEach(() => {
  resetCoinpayCaches();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('plan checkout page', () => {
  it('sells one option per plan at the catalog price', () => {
    const table = PLAN_IDS.map((plan) => {
      const options = planCheckout(plan).config.options as { id: string; chargeCents: number }[];
      return options.map((o) => [o.id, o.chargeCents]);
    });
    expect(table).toEqual([[['plus', 100]], [['pro', 1200]], [['team', 4900]]]);
  });

  it.each(PLAN_IDS)(
    'opens the same CoinPay session and payment row as the JSON route: %s',
    async (plan) => {
      const api = await planApi(jsonRequest('https://pairux.com/api/billing/checkout', { plan }));
      expect(api.status).toBe(200);
      const apiRow = lastRow();

      const result = await planCheckout(plan).handle({ option: plan });
      expect(result).toMatchObject({
        ok: true,
        url: 'https://coinpayportal.com/checkout/cs_test',
        id: 'cs_test',
      });

      expect(sessions).toHaveLength(2);
      expect(sessions[1]).toEqual(sessions[0]);
      expect(sessions[1]).toMatchObject({
        amount: PLANS[plan].priceUsd,
        account_id: USER.id,
        customer_email: USER.email,
        success_url: `https://pairux.com/upgrade/${plan}?payment=success`,
        cancel_url: 'https://pairux.com/pricing?payment=cancelled',
        metadata: { type: 'plan', plan, user_id: USER.id },
      });
      expect(lastRow()).toEqual(apiRow);
      expect(auth.rows).toHaveLength(2);
    }
  );

  it('passes a missing email on as the JSON route does', async () => {
    auth.user = { id: 'user-2', email: null };
    await planApi(jsonRequest('https://pairux.com/api/billing/checkout', { plan: 'pro' }));
    await planCheckout('pro').handle({ option: 'pro' });
    expect(sessions[1]).toEqual(sessions[0]);
    expect(sessions[1]).not.toHaveProperty('customer_email');
  });

  it('refuses to open a payment when the catalog price is not the one the page showed', async () => {
    const checkout = planCheckout('pro');
    const real = PLANS.pro.priceUsd;
    PLANS.pro.priceUsd = real + 1;
    try {
      expect(await checkout.handle({ option: 'pro' })).toEqual({
        ok: false,
        error: 'payment_unavailable',
      });
    } finally {
      PLANS.pro.priceUsd = real;
    }
    expect(sessions).toHaveLength(0);
    expect(auth.rows).toHaveLength(0);
  });

  it('refuses another plan posted to this plan page', async () => {
    expect(await planCheckout('plus').handle({ option: 'team' })).toEqual({
      ok: false,
      error: 'invalid_option',
    });
    expect(sessions).toHaveLength(0);
  });

  it('keeps the coin and PayPal picker when CoinPay offers no hosted session', async () => {
    sessionStatus = 404;
    const result = await planCheckout('team').handle({ option: 'team' });
    expect(result).toMatchObject({ ok: true, url: '/upgrade/team?pay=methods' });
    expect(auth.rows).toHaveLength(0);
  });

  it('sends a signed-out buyer to log in and back to the page', async () => {
    auth.user = null;
    const response = await planForm(
      formRequest(
        'https://pairux.com/api/checkout/plan/pro',
        { option: 'pro' },
        { origin: 'https://pairux.com', referer: 'https://pairux.com/upgrade/pro' }
      ),
      { params: Promise.resolve({ plan: 'pro' }) }
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/login?redirect=${encodeURIComponent('/upgrade/pro?option=pro')}`
    );
    expect(sessions).toHaveLength(0);
  });

  it('redirects the posted form to the payment page', async () => {
    const response = await planForm(
      formRequest(
        'https://pairux.com/api/checkout/plan/plus',
        { option: 'plus' },
        { origin: 'https://pairux.com' }
      ),
      { params: Promise.resolve({ plan: 'plus' }) }
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://coinpayportal.com/checkout/cs_test');
  });

  it('refuses a form posted from another site, and an unknown plan', async () => {
    const foreign = await planForm(
      formRequest(
        'https://pairux.com/api/checkout/plan/pro',
        { option: 'pro' },
        { origin: 'https://evil.example', accept: 'application/json' }
      ),
      { params: Promise.resolve({ plan: 'pro' }) }
    );
    expect(foreign.status).toBe(403);
    const unknown = await planForm(
      formRequest('https://pairux.com/api/checkout/plan/free', { option: 'free' }),
      { params: Promise.resolve({ plan: 'free' }) }
    );
    expect(unknown.status).toBe(404);
    expect(sessions).toHaveLength(0);
  });
});

describe('copilot credit checkout page', () => {
  it('sells the three packs at their prices, none marked popular', () => {
    const options = copilotCheckout().config.options as {
      id: string;
      chargeCents: number;
      popular: boolean;
    }[];
    expect(options.map((o) => [o.id, o.chargeCents])).toEqual([
      ['copilot_credit_5', 500],
      ['copilot_credit_20', 2000],
      ['copilot_credit_50', 5000],
    ]);
    expect(options.some((o) => o.popular)).toBe(false);
  });

  it.each(COPILOT_TOPUPS.map((one) => one.id))(
    'opens the same CoinPay session and payment row as the JSON route: %s',
    async (id) => {
      const api = await topupApi(
        jsonRequest('https://pairux.com/api/billing/copilot-topup', { topup: id })
      );
      expect(api.status).toBe(200);
      const apiRow = lastRow();

      const result = await copilotCheckout().handle({ option: id });
      expect(result).toMatchObject({ ok: true, url: 'https://coinpayportal.com/checkout/cs_test' });

      expect(sessions).toHaveLength(2);
      expect(sessions[1]).toEqual(sessions[0]);
      expect(sessions[1]).toMatchObject({
        account_id: USER.id,
        success_url: 'https://pairux.com/settings/copilot?payment=success',
        cancel_url: 'https://pairux.com/settings/copilot?payment=cancelled',
        metadata: { type: 'copilot_credit', plan: id },
      });
      expect(lastRow()).toEqual(apiRow);
    }
  );

  it('says checkout is unavailable when CoinPay offers no hosted session', async () => {
    sessionStatus = 404;
    expect(await copilotCheckout().handle({ option: 'copilot_credit_20' })).toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(auth.rows).toHaveLength(0);
  });

  it('opens the page with the amount from the link picked', () => {
    const view = copilotCheckout().view({ query: { option: 'copilot_credit_50' }, account: USER });
    expect(view.selected).toBe('copilot_credit_50');
  });

  it('sends a signed-out buyer to log in and back with the amount', async () => {
    auth.user = null;
    const response = await creditForm(
      formRequest(
        'https://pairux.com/api/checkout/copilot-credit',
        { option: 'copilot_credit_20' },
        { origin: 'https://pairux.com' }
      )
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/login?redirect=${encodeURIComponent('/settings/copilot/add-credit?option=copilot_credit_20')}`
    );
  });
});
