/**
 * Geometry helpers for positioning overlays on top of an `object-contain` video.
 *
 * A video rendered with `object-contain` is letterboxed inside its container, so the
 * visible picture rarely fills the whole element. The camera bubble needs to be
 * positioned relative to that *visible picture* — not the container — so that what the
 * user sees on screen matches what gets composited into the recording (which is sized
 * to the source's native resolution).
 */

// The implementation lives in @pairux/shared-types, because the input path
// needs the same rectangle and the two must not be allowed to disagree:
// an overlay drawn against one and clicks mapped against the other put the
// remote cursor somewhere the click does not land.
export { getContainRect, type ContainRect as Rect } from '@pairux/shared-types';

/** Clamp a value to the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
