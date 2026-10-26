import { describe, it, expect, vi, beforeEach } from 'vitest';

const user = { current: null as { id: string } | null };
vi.mock('@/lib/request-user', () => ({
  requestUser: () => Promise.resolve(user.current),
  isAdminUser: () => Promise.resolve(false),
}));
const redeem = vi.fn();
vi.mock('@/lib/credits', () => ({
  redeemCreditCode: (...a: unknown[]) => redeem(...a) as unknown,
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('https://pairux.com/api/credits/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  user.current = { id: 'u1' };
  redeem.mockReset();
});

describe('POST /api/credits/redeem', () => {
  it('needs a signed-in user', async () => {
    user.current = null;
    expect((await POST(req({ code: 'CR-1' }))).status).toBe(401);
  });

  it('rejects an empty code without calling the store', async () => {
    expect((await POST(req({ code: '  ' }))).status).toBe(400);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('returns the friendly reason for a bad code', async () => {
    redeem.mockResolvedValue({
      ok: false,
      reason: 'used_up',
      message: 'That code has already been used.',
    });
    const res = await POST(req({ code: 'CR-AAAA-BBBB-CCCC-DDDD' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      reason: 'used_up',
      error: 'That code has already been used.',
    });
  });

  it('reports the plan and its new end date', async () => {
    redeem.mockResolvedValue({
      ok: true,
      plan: 'pro',
      days: 30,
      view: { plan: 'pro', effectivePlan: 'pro', planExpiresAt: '2026-11-25T00:00:00Z' },
    });
    const res = await POST(req({ code: 'CR-AAAA-BBBB-CCCC-DDDD' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { message: string; effectivePlan: string } };
    expect(body.data.effectivePlan).toBe('pro');
    expect(body.data.message).toBe('Code redeemed: 30 days of PairUX Pro.');
    expect(redeem).toHaveBeenCalledWith('u1', 'CR-AAAA-BBBB-CCCC-DDDD');
  });
});
