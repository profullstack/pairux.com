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
      getClientIp(
        new Request('https://pairux.com', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
      )
    ).toBe('1.2.3.4');
  });

  it('prefers x-real-ip over the forwarded chain', () => {
    expect(
      getClientIp(
        new Request('https://pairux.com', {
          headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.2.3.4' },
        })
      )
    ).toBe('9.9.9.9');
  });

  it('falls back to the shared bucket with no proxy headers', () => {
    expect(getClientIp(new Request('https://pairux.com'))).toBe('unknown');
  });

  /**
   * A leading comma trims the first hop to an empty string. That must land on
   * the same shared bucket as "no header at all" — an empty key would be a
   * *distinct* bucket, letting a client double its own allowance for free. This
   * is why getClientIp cannot simply use `??`, which returns the empty string.
   */
  it.each([',1.2.3.4', '   , 1.2.3.4', '', '   '])(
    'treats a blank first hop (%j) as the shared bucket',
    (header) => {
      expect(
        getClientIp(new Request('https://pairux.com', { headers: { 'x-forwarded-for': header } }))
      ).toBe('unknown');
    }
  );

  it('trims whitespace around a forwarded address', () => {
    expect(
      getClientIp(
        new Request('https://pairux.com', {
          headers: { 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' },
        })
      )
    ).toBe('1.2.3.4');
  });
});
