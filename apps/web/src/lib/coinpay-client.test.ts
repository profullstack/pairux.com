import { describe, it, expect } from 'vitest';
import { PLANS, getPlanDef, TERM_DAYS } from './plans';

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
