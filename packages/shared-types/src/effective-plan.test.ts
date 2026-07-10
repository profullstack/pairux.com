import { describe, it, expect } from 'vitest';
import { effectivePlan } from './database.js';

describe('effectivePlan', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it('keeps free as free regardless of expiry', () => {
    expect(effectivePlan('free', null)).toBe('free');
    expect(effectivePlan('free', future)).toBe('free');
  });

  it('honors a paid plan while the period is active', () => {
    expect(effectivePlan('pro', future)).toBe('pro');
    expect(effectivePlan('team', future)).toBe('team');
  });

  it('lapses a paid plan to free once expired', () => {
    expect(effectivePlan('pro', past)).toBe('free');
    expect(effectivePlan('team', past)).toBe('free');
  });

  it('treats a paid plan with no expiry as free (never granted)', () => {
    expect(effectivePlan('pro', null)).toBe('free');
  });
});
