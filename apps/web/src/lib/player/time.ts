/**
 * Clock formatting and the `?t=` URL parameter.
 *
 * Split out from the player because it is the part with real edge cases and no
 * DOM: a duration that is NaN until metadata lands, a share link somebody typed
 * by hand, and the fact that the same number is written three different ways by
 * the three sites people arrive from.
 */

/**
 * Seconds as a clock, `1:23` or `1:02:03`.
 *
 * Hours appear only when there are hours, so an ordinary talk is not padded out
 * to `0:07:31` — the reader is looking at this every second the player is open.
 * Anything not a finite number is `--:--` rather than `NaN:NaN`, which is the
 * honest reading before metadata arrives.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hrs > 0 ? `${String(hrs)}:${pad(mins)}:${pad(secs)}` : `${String(mins)}:${pad(secs)}`;
}

/**
 * Read a `?t=` value.
 *
 * Accepts every form anyone actually writes: bare seconds (`372`), YouTube's
 * unit string (`6m12s`, `1h2m3s`), and a pasted clock (`6:12`, `1:02:03`). A
 * link is a thing people edit by hand and forward to each other, so refusing a
 * reasonable spelling is a broken link rather than a teaching moment.
 *
 * @returns whole seconds, or null if this is not a time at all
 */
export function parseTimeParam(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === '') return null;

  // 6:12 or 1:02:03 — a pasted clock.
  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length > 3) return null;
    let total = 0;
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null;
      total = total * 60 + Number(part);
    }
    return total;
  }

  // Bare seconds, with or without a trailing s.
  if (/^\d+s?$/.test(value)) return Number(value.replace('s', ''));

  // 1h2m3s, in any subset, but the units must be in descending order and each
  // may appear once — `3s2m` is a typo, not an intention worth guessing at.
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    return null;
  }
  const hrs = Number(match[1] ?? 0);
  const mins = Number(match[2] ?? 0);
  const secs = Number(match[3] ?? 0);
  return hrs * 3600 + mins * 60 + secs;
}

/**
 * The `t` value to put in a share link.
 *
 * Whole seconds, because it round-trips through every parser above including
 * other sites', and because a fractional offset is a false precision — nobody
 * means 372.418 when they say "watch from here".
 */
export function formatTimeParam(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  return String(Math.floor(seconds));
}
