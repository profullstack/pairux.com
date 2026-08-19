/**
 * Small, bounded, process-local rate limiter for abuse-sensitive API routes.
 *
 * It is deliberately a first line of defence: production deployments should
 * also enforce equivalent limits at the CDN/WAF. Keeping this limiter bounded
 * means an attacker cannot exhaust server memory just by inventing new keys.
 */
export interface RateLimitResult {
  success: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries = 10_000
  ) {}

  /** How many keys are currently tracked. For tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.entries.get(key);

    if (!existing || now >= existing.resetAt) {
      // Delete before re-inserting so the refreshed entry moves to the tail.
      // `Map.set` on a key that already exists keeps its original position, and
      // prune() depends on iteration order matching expiry order — a key whose
      // window is starting over is the newest thing in the map, not the oldest.
      if (existing) this.entries.delete(key);

      this.prune(now);
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return { success: true, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    if (existing.count >= this.limit) return { success: false, retryAfterSeconds };

    existing.count += 1;
    return { success: true, retryAfterSeconds };
  }

  reset(): void {
    this.entries.clear();
  }

  /**
   * Drop what has expired, and make room if the table is still full.
   *
   * Every entry is written with `resetAt = now + windowMs` for one constant
   * window, and `check` re-inserts a refreshed key at the tail, so iteration
   * order is ascending `resetAt`. That is what makes the early exit safe: the
   * first entry still inside its window means every entry after it is too, so
   * there is nothing further to expire.
   *
   * The previous version broke off after examining a single entry whenever the
   * map was below its cap, so expired entries accumulated until the table
   * filled up — and once full it evicted whichever key happened to be first
   * rather than the one nearest expiry, which could reset a live throttle while
   * an about-to-expire entry survived.
   *
   * Cost is amortised O(1) per call: an entry is deleted once in its life, plus
   * at most one eviction here.
   */
  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt > now) break;
      this.entries.delete(key);
    }

    // Still at the cap, so every remaining entry is live. Evict the one closest
    // to expiring — it is the least useful to keep, and taking it costs the
    // caller the least amount of tracked history.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}

/** Use proxy-provided client IP headers, with a conservative shared fallback. */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  const forwardedFor = request.headers.get('x-forwarded-for');
  const firstHop = forwardedFor?.split(',', 1)[0]?.trim();

  // Deliberately not `?? 'unknown'`. An `x-forwarded-for` of ", 1.2.3.4" trims
  // to an empty string, which `??` would happily return — and an empty key is a
  // *different* rate-limit bucket from the shared fallback, so a client could
  // double its own allowance just by prefixing a comma. Empty and absent both
  // have to land on 'unknown'.
  return firstHop !== undefined && firstHop !== '' ? firstHop : 'unknown';
}
