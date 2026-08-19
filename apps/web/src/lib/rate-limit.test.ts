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

  /**
   * prune() used to break out after looking at a single entry whenever the map
   * was below its cap, so expired entries piled up until the table filled.
   */
  it('drops every expired entry, not just the first', () => {
    const limiter = new FixedWindowRateLimiter(5, 1_000);

    for (let i = 0; i < 50; i += 1) limiter.check(`key-${String(i)}`, 0);
    expect(limiter.size).toBe(50);

    // One new key past the window: every one of the 50 has expired.
    limiter.check('fresh', 2_000);
    expect(limiter.size).toBe(1);
  });

  it('keeps entries that are still inside their window', () => {
    const limiter = new FixedWindowRateLimiter(5, 1_000);

    limiter.check('old', 0);
    limiter.check('recent', 900);
    // 'old' expired at 1000, 'recent' not until 1900.
    limiter.check('fresh', 1_500);

    expect(limiter.size).toBe(2);
    // 'recent' kept its count rather than being pruned and restarted.
    expect(limiter.check('recent', 1_600).success).toBe(true);
  });

  it('stays bounded once every entry is live', () => {
    const limiter = new FixedWindowRateLimiter(5, 10_000, 10);

    for (let i = 0; i < 100; i += 1) limiter.check(`key-${String(i)}`, i);

    expect(limiter.size).toBeLessThanOrEqual(10);
  });

  /**
   * At the cap with nothing expired, the entry nearest expiring is the one to
   * drop. Evicting by raw insertion order could reset a throttle that still had
   * most of its window left while a nearly-dead entry survived.
   */
  it('evicts the entry closest to expiring when full', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, 2);

    limiter.check('oldest', 0); // expires at 1000
    limiter.check('newer', 500); // expires at 1500

    // Full, nothing expired yet. Inserting evicts 'oldest'.
    limiter.check('newest', 600);

    expect(limiter.size).toBe(2);
    // 'newer' survived, so it is still throttled at its limit of 1.
    expect(limiter.check('newer', 700).success).toBe(false);
    // 'oldest' was evicted, so it starts a fresh window.
    expect(limiter.check('oldest', 700).success).toBe(true);
  });

  /**
   * A key whose window restarts is the newest entry, but `Map.set` on an
   * existing key keeps its original position. Without an explicit delete first,
   * a stale-positioned live entry sits at the head and stops the expiry sweep
   * before it reaches genuinely expired keys behind it.
   */
  it('sweeps past a key whose window restarted', () => {
    const limiter = new FixedWindowRateLimiter(5, 1_000);

    limiter.check('a', 0);
    limiter.check('b', 0);
    limiter.check('c', 0);

    // 'a' restarts at 1200; 'b' and 'c' are expired and should be reachable.
    limiter.check('a', 1_200);
    expect(limiter.size).toBe(1);
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
