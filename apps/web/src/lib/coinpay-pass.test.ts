import { describe, expect, it, vi } from 'vitest';
import { passFromUserinfo } from '@profullstack/coinpay-onboard/pass';
import { applyCoinpayPass, passUntilToApply } from './coinpay-pass';

const NOW = Date.parse('2026-11-07T00:00:00Z');
const END = '2026-12-07T00:00:00.000Z';
const claim = (pass: unknown) => passFromUserinfo({ pass }, new Date(NOW));

describe('coinpay pass', () => {
  it('applies only an active pass that ends in the future', () => {
    expect(passUntilToApply(claim({ active: true, expires_at: END }), NOW)).toBe(END);
    expect(passUntilToApply(claim({ active: false, expires_at: END }), NOW)).toBeNull();
    expect(passUntilToApply(claim({ active: true, expires_at: 'x' }), NOW)).toBeNull();
    expect(
      passUntilToApply(claim({ active: true, expires_at: '2026-01-01T00:00:00Z' }), NOW)
    ).toBeNull();
    expect(passUntilToApply(undefined, NOW)).toBeNull();
  });

  it('calls the service-role RPC with the pass end for the bound user', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: END, error: null });
    await expect(
      applyCoinpayPass({ rpc } as never, 'user-1', claim({ active: true, expires_at: END }), NOW)
    ).resolves.toBe(END);
    expect(rpc).toHaveBeenCalledWith('plan_apply_coinpay_pass', {
      p_user_id: 'user-1',
      p_until: END,
    });
  });

  it('does nothing without an active pass, and surfaces RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(
      applyCoinpayPass({ rpc } as never, 'user-1', claim({ active: false }), NOW)
    ).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      applyCoinpayPass({ rpc } as never, 'user-1', claim({ active: true, expires_at: END }), NOW)
    ).rejects.toThrow('boom');
  });
});
