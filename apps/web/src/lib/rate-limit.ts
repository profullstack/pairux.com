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

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.entries.get(key);

    if (!existing || now >= existing.resetAt) {
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

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now || this.entries.size >= this.maxEntries) this.entries.delete(key);
      if (this.entries.size < this.maxEntries) break;
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
