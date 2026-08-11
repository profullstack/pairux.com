/**
 * Turning a browser's scroll deltas into wheel notches the host can inject.
 *
 * The naive conversion — `Math.round(delta / 100) || 1` — is wrong in both
 * directions at once, and the `|| 1` is what makes it unusable.
 *
 * A mouse wheel reports one notch as roughly 100 pixels, so dividing by 100 is
 * right for a wheel. A trackpad does not report notches at all: it reports the
 * actual pixels your fingers moved, dozens of events of 2-4px each. Every one
 * of those rounds to 0, the `|| 1` promotes it to a full notch, and a gentle
 * two-finger drag arrives at the host as thirty hard wheel clicks. That is the
 * "scrolling is insanely fast" report.
 *
 * So deltas are accumulated instead of rounded. Fractions of a notch are
 * carried to the next event, which makes a trackpad's small deltas add up the
 * way they do locally, and leaves a real wheel exactly where it was: one 100px
 * event is still one notch.
 */

/** DOM `WheelEvent.deltaMode`. */
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;

/**
 * Pixels per wheel notch.
 *
 * Chromium reports 100 per notch on Windows and Linux and 120 on some mice; the
 * exact figure matters less than being consistent, because the remainder is
 * carried rather than discarded.
 */
const PIXELS_PER_NOTCH = 100;
/** A "line" is about this many pixels, and about a third of a notch. */
const PIXELS_PER_LINE = 33;
/** A page scroll is a screenful; treat it as a firm push rather than guessing. */
const NOTCHES_PER_PAGE = 3;

/** Convert a DOM delta in its own units into a (fractional) number of notches. */
export function deltaToNotches(delta: number, deltaMode: number = DELTA_MODE_PIXEL): number {
  if (!Number.isFinite(delta)) return 0;

  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return (delta * PIXELS_PER_LINE) / PIXELS_PER_NOTCH;
    case DELTA_MODE_PAGE:
      return delta * NOTCHES_PER_PAGE;
    default:
      return delta / PIXELS_PER_NOTCH;
  }
}

/**
 * Accumulates fractional scroll notches so small deltas are not lost or
 * inflated.
 *
 * One instance per axis per backend. The carried remainder is what makes a
 * trackpad usable: thirty 3px events become one notch at roughly the right
 * moment, instead of thirty notches or none at all.
 */
export class ScrollAccumulator {
  private carry = 0;

  /**
   * Fold in a delta and return whole notches to inject, positive or negative.
   * The unused fraction stays for next time.
   */
  add(delta: number, deltaMode: number = DELTA_MODE_PIXEL): number {
    this.carry += deltaToNotches(delta, deltaMode);

    // Truncate toward zero: a half-notch of leftover must not become a notch in
    // the opposite direction when the user reverses.
    // `|| 0` normalizes the -0 that truncating a small negative carry produces,
    // so callers comparing against 0 see one value rather than two.
    const whole = Math.trunc(this.carry) || 0;
    this.carry -= whole;
    return whole;
  }

  /**
   * Drop any partial notch.
   *
   * Called when a gesture ends or control changes hands, so a half-notch of
   * left-over upward scroll cannot surface in the middle of the next downward
   * one.
   */
  reset(): void {
    this.carry = 0;
  }
}
