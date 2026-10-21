/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@profullstack/stack/coinpay', () => ({
  verifyCoinPayWebhook: ({ signature }: { signature: string | null }) => signature === 'good',
}));

interface Row {
  coinpay_payment_id: string;
  user_id: string;
  plan: string;
  credited_at: string | null;
  amount_usd?: number;
}
let rows: Row[] = [];
const rpc = vi.fn();
const inserts: unknown[] = [];

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => ({
          limit: async () => ({
            data: rows.filter((r) => ids.includes(r.coinpay_payment_id)),
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async (row: Row) => {
        inserts.push(row);
        rows.push({ ...row, credited_at: null });
        return { error: null };
      },
    }),
    rpc: async (name: string, args: unknown) => {
      rpc(name, args);
      return { data: null, error: null };
    },
  }),
}));

process.env.COINPAY_WEBHOOK_SECRET = 'secret';
const { POST } = await import('./route');

function hook(body: unknown, signature = 'good') {
  return POST(
    new Request('https://pairux.com/api/webhooks/coinpay', {
      method: 'POST',
      headers: { 'x-coinpay-signature': signature },
      body: JSON.stringify(body),
    }) as any
  );
}

beforeEach(() => {
  rows = [];
  inserts.length = 0;
  rpc.mockReset();
});

describe('POST /api/webhooks/coinpay', () => {
  it('refuses a bad signature', async () => {
    expect((await hook({}, 'bad')).status).toBe(401);
  });

  it('grants one term through the atomic RPC on a confirmed payment', async () => {
    rows = [{ coinpay_payment_id: 'pay_1', user_id: 'u1', plan: 'pro', credited_at: null }];
    const res = await hook({
      type: 'payment.confirmed',
      data: { payment_id: 'pay_1', status: 'confirmed' },
    });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('plan_credit_payment', {
      p_payment_id: 'pay_1',
      p_days: 31,
      p_status: 'confirmed',
    });
  });

  it('finds a hosted session row by checkout_session_id', async () => {
    rows = [{ coinpay_payment_id: 'cs_1', user_id: 'u1', plan: 'plus', credited_at: null }];
    await hook({
      type: 'payment.confirmed',
      data: { payment_id: 'pay_9', checkout_session_id: 'cs_1', status: 'confirmed' },
    });
    expect(rpc).toHaveBeenCalledWith(
      'plan_credit_payment',
      expect.objectContaining({ p_payment_id: 'cs_1' })
    );
  });

  it('does not grant on an unsettled status', async () => {
    rows = [{ coinpay_payment_id: 'pay_1', user_id: 'u1', plan: 'pro', credited_at: null }];
    await hook({ type: 'payment.detected', data: { payment_id: 'pay_1', status: 'detected' } });
    await hook({ type: 'payment.expired', data: { payment_id: 'pay_1', status: 'expired' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rebuilds a missing row from pairux metadata, and ignores other properties', async () => {
    await hook({
      type: 'payment.confirmed',
      data: {
        payment_id: 'pp_1',
        status: 'confirmed',
        metadata: { property: 'smshub.dev', account_id: 'u2', plan: 'pro' },
      },
    });
    expect(inserts).toHaveLength(0);
    await hook({
      type: 'payment.confirmed',
      data: {
        payment_id: 'pp_1',
        status: 'confirmed',
        amount_usd: 12,
        metadata: { property: 'pairux.com', account_id: 'u2', plan: 'pro' },
      },
    });
    expect(inserts).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      'plan_credit_payment',
      expect.objectContaining({ p_payment_id: 'pp_1' })
    );
  });
});
