/**
 * Turning "the guest is watching monitor 2" into coordinates the injector can
 * use.
 *
 * Two coordinate spaces have to be reconciled, and they are not always the
 * same one:
 *
 * - The window system reports displays in *logical* units, laid out side by
 *   side on a virtual desktop. A 4K monitor at 200% scaling to the right of a
 *   1080p primary is reported as 1920 wide starting at x=1920.
 * - The injection backend positions the pointer in whatever space it measured
 *   the primary display in. On a Retina Mac or a scaled Windows desktop that
 *   can be physical pixels rather than logical points.
 *
 * Mapping a display's logical rectangle straight into a backend that works in
 * physical pixels halves every coordinate — the exact shape of the earlier
 * Retina bug, where the centre of the screen landed at the bottom-right corner.
 * So the ratio between the two measurements of the *primary* display is
 * recovered and applied, which needs no per-platform special-casing: where the
 * spaces already agree the ratio is 1 and nothing changes.
 */

import type { CaptureBounds } from './types.js';

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureBoundsInput {
  /** The shared display's rectangle, in the window system's logical space. */
  display: DisplayRect;
  /** The primary display's rectangle, in that same logical space. */
  primary: DisplayRect;
  /** The primary display's size as the injection backend measured it. */
  backendPrimary: { width: number; height: number };
}

/**
 * Resolve a display rectangle into the backend's coordinate space.
 *
 * Returns null when the inputs cannot produce a usable rectangle, which the
 * caller should treat as "keep mapping onto the primary display" rather than
 * injecting into a degenerate one.
 */
export function resolveCaptureBounds(input: CaptureBoundsInput): CaptureBounds | null {
  const { display, primary, backendPrimary } = input;

  if (display.width <= 0 || display.height <= 0) return null;
  if (primary.width <= 0 || primary.height <= 0) return null;
  if (backendPrimary.width <= 0 || backendPrimary.height <= 0) return null;

  // How many backend units there are per logical unit. Derived rather than
  // assumed, so a host whose spaces already agree gets exactly 1.
  const scaleX = backendPrimary.width / primary.width;
  const scaleY = backendPrimary.height / primary.height;

  // Offsets are relative to the primary display's origin, because that is
  // where both spaces put (0, 0).
  return {
    x: Math.round((display.x - primary.x) * scaleX),
    y: Math.round((display.y - primary.y) * scaleY),
    width: Math.round(display.width * scaleX),
    height: Math.round(display.height * scaleY),
  };
}
