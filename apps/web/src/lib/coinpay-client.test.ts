import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyCoinpayWebhook } from './coinpay-client';
import { PLANS, getPlanDef, TERM_DAYS } from './plans';

function sign(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto
    .createHmac('sha256', secret)
    .update(`${String(ts)}.${rawBody}`)
    .digest('hex');
  return `t=${String(ts)},v1=${v1}`;
}

describe('verifyCoinpayWebhook', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ type: 'payment.confirmed', data: { payment_id: 'p1' } });

  it('accepts a valid signature', () => {
    expect(verifyCoinpayWebhook(body, sign(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = sign(body, secret);
    expect(verifyCoinpayWebhook(body + 'x', header, secret)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyCoinpayWebhook(body, sign(body, secret), 'nope')).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyCoinpayWebhook(body, null, secret)).toBe(false);
    expect(verifyCoinpayWebhook(body, 'garbage', secret)).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600;
    expect(verifyCoinpayWebhook(body, sign(body, secret, oldTs), secret)).toBe(false);
  });
});

describe('plans', () => {
  it('prices match the public pricing page', () => {
    expect(PLANS.pro.priceUsd).toBe(12);
    expect(PLANS.team.priceUsd).toBe(49);
    expect(TERM_DAYS).toBe(31);
  });

  it('resolves only known paid plans', () => {
    expect(getPlanDef('pro')?.id).toBe('pro');
    expect(getPlanDef('team')?.id).toBe('team');
    expect(getPlanDef('free')).toBeNull();
    expect(getPlanDef('bogus')).toBeNull();
  });
});
