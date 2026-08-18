import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter, getClientIp } from './rate-limit';

describe('FixedWindowRateLimiter', () => {
  it('enforces a per-key limit until the window expires', () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.check('viewer', 0).success).toBe(true);
    expect(limiter.check('viewer', 1).success).toBe(true);
    expect(limiter.check('viewer', 2)).toEqual({ success: false, retryAfterSeconds: 1 });
    expect(limiter.check('viewer', 1_000).success).toBe(true);
  });

  it('uses the first forwarded address as the client identity', () => {
    expect(
      getClientIp(new Request('https://pairux.com', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))
    ).toBe('1.2.3.4');
  });
});
