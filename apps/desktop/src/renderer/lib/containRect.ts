/**
 * Geometry helpers for positioning overlays on top of an `object-contain` video.
 *
 * A video rendered with `object-contain` is letterboxed inside its container, so the
 * visible picture rarely fills the whole element. The camera bubble needs to be
 * positioned relative to that *visible picture* — not the container — so that what the
 * user sees on screen matches what gets composited into the recording (which is sized
 * to the source's native resolution).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the rectangle occupied by `object-contain` content of size
 * (contentWidth x contentHeight) rendered inside a (containerWidth x containerHeight) box.
 *
 * Falls back to the full container rect when any dimension is non-positive.
 */
export function getContainRect(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number
): Rect {
  if (containerWidth <= 0 || containerHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(containerWidth, 0), height: Math.max(containerHeight, 0) };
  }

  const scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);
  const width = contentWidth * scale;
  const height = contentHeight * scale;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

/** Clamp a value to the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
