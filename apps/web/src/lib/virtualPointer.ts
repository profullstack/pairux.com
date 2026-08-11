/**
 * Where the guest is pointing on the host's screen, tracked independently of
 * where their real cursor is.
 *
 * Mapping the guest's cursor position inside the video element straight onto
 * the host's screen sounds right and is unusable in practice: to reach the top
 * of the host's screen the guest's real cursor has to sit exactly on the top
 * edge of the video, and a few pixels further leaves the window altogether.
 * Screen corners are effectively unreachable, and overshooting silently stops
 * input. Reported as "my mouse leaves the window when I try to go up to the
 * top".
 *
 * Under pointer lock there is no cursor position to read — the browser reports
 * movement deltas instead — so the remote position is accumulated here and
 * clamped to the screen. The guest can then push past an edge and stay there,
 * which is what reaching a menu bar or a corner requires.
 */

export interface NormalizedPoint {
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Advance a normalized position by a pixel delta over a surface of `width` x
 * `height` pixels.
 *
 * Clamping rather than wrapping is deliberate: a pointer pushed at the top of
 * the screen must stay pinned there, the way a real one does, so menu bars and
 * corners are reachable by overshooting instead of requiring precision.
 */
export function advanceVirtualPointer(
  from: NormalizedPoint,
  movementX: number,
  movementY: number,
  width: number,
  height: number
): NormalizedPoint {
  if (width <= 0 || height <= 0) return from;

  return {
    x: clamp01(from.x + movementX / width),
    y: clamp01(from.y + movementY / height),
  };
}
