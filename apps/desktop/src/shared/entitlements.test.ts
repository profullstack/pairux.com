import { describe, it, expect } from 'vitest';
import { FREE_PLATFORMS, isPaidPlan, isPaidPlatform, isPlatformAllowed } from './entitlements';

describe('entitlements', () => {
  it('treats only YouTube as free', () => {
    expect(FREE_PLATFORMS).toEqual(['youtube']);
    expect(isPaidPlatform('youtube')).toBe(false);
    expect(isPaidPlatform('twitch')).toBe(true);
    expect(isPaidPlatform('facebook')).toBe(true);
    expect(isPaidPlatform('custom')).toBe(true);
  });

  it('identifies paid plans', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('pro')).toBe(true);
    expect(isPaidPlan('team')).toBe(true);
  });

  it('allows free plan to stream to YouTube only', () => {
    expect(isPlatformAllowed('youtube', 'free')).toBe(true);
    expect(isPlatformAllowed('twitch', 'free')).toBe(false);
    expect(isPlatformAllowed('facebook', 'free')).toBe(false);
    expect(isPlatformAllowed('custom', 'free')).toBe(false);
  });

  it('allows paid plans to stream everywhere', () => {
    for (const plan of ['pro', 'team'] as const) {
      expect(isPlatformAllowed('youtube', plan)).toBe(true);
      expect(isPlatformAllowed('twitch', plan)).toBe(true);
      expect(isPlatformAllowed('facebook', plan)).toBe(true);
      expect(isPlatformAllowed('custom', plan)).toBe(true);
    }
  });
});
