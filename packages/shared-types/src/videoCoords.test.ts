/**
 * Mapping a pointer on the viewer's screen to a point on the host's.
 *
 * This is the widest-reaching way remote control goes wrong, because it fails
 * quietly and by a margin that depends on the viewer's window shape. The
 * player letterboxes the remote screen with `object-contain`, and coordinates
 * were normalized against the video *element* rather than the picture inside
 * it — so every click carried an offset and a scale error proportional to how
 * much dead space there was. A viewer whose window happened to match the
 * host's aspect ratio saw nothing wrong at all.
 */

import { describe, it, expect } from 'vitest';
import { getContainRect, normalizedPointOnVideo } from './input.js';

describe('getContainRect', () => {
  it('fills the box when the aspect ratios match', () => {
    expect(getContainRect(1600, 900, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
    });
  });

  // A 16:9 screen in a taller window: bars above and below.
  it('centres the picture with bars on the constrained axis', () => {
    const rect = getContainRect(1000, 1000, 1920, 1080);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(218.75);
    expect(rect.width).toBeCloseTo(1000);
    expect(rect.height).toBeCloseTo(562.5);
  });

  it('puts the bars at the sides when the window is wider', () => {
    expect(getContainRect(2000, 1000, 1000, 1000)).toEqual({
      x: 500,
      y: 0,
      width: 1000,
      height: 1000,
    });
  });

  // videoWidth is 0 until the stream's metadata arrives, and the mapping has
  // to stay usable in that window rather than collapsing to nothing.
  it('falls back to the whole box before the stream reports its size', () => {
    expect(getContainRect(1000, 800, 0, 0)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });
});

describe('normalizedPointOnVideo', () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 1000 };

  // The bug, stated plainly. A 16:9 screen in a square window letterboxes to
  // 1000x562.5 with 218.75px bars. The top-left of the picture is 218.75px
  // down the element, and normalizing against the element called that 0.219 —
  // so the guest clicked the very top of the host's screen and the pointer
  // landed a fifth of the way down it.
  it('reads the top-left of the picture as the top-left of the screen', () => {
    const point = normalizedPointOnVideo(0, 218.75, bounds, 1920, 1080);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
  });

  it('reads the centre of the picture as the centre of the screen', () => {
    expect(normalizedPointOnVideo(500, 500, bounds, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('reads the bottom-right of the picture as the bottom-right of the screen', () => {
    const point = normalizedPointOnVideo(1000, 781.25, bounds, 1920, 1080);
    expect(point.x).toBeCloseTo(1);
    expect(point.y).toBeCloseTo(1);
  });

  // How far off it used to be, at the point a guest is most likely to aim:
  // a menu bar at the top of the host's screen.
  it('no longer lands a fifth of the way down when aiming at the top', () => {
    const naive = 218.75 / 1000;
    const corrected = normalizedPointOnVideo(500, 218.75, bounds, 1920, 1080).y;
    expect(naive).toBeCloseTo(0.219);
    expect(corrected).toBe(0);
  });

  it('offsets by the element’s position on the page', () => {
    const offset = { left: 200, top: 100, width: 1000, height: 1000 };
    expect(normalizedPointOnVideo(700, 600, offset, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 });
  });

  // Clicking a letterbox bar clamps to the nearest edge rather than doing
  // nothing, for the same reason coordinates are clamped everywhere else: the
  // screen edges have to stay reachable.
  it('clamps a position in the letterbox to the edge of the screen', () => {
    expect(normalizedPointOnVideo(500, 10, bounds, 1920, 1080).y).toBe(0);
    expect(normalizedPointOnVideo(500, 990, bounds, 1920, 1080).y).toBe(1);
  });

  it('behaves like the old mapping when the picture fills the element', () => {
    const point = normalizedPointOnVideo(250, 500, { ...bounds, height: 562.5 }, 1920, 1080);
    expect(point.x).toBeCloseTo(0.25);
    expect(point.y).toBeCloseTo(0.889, 3);
  });

  it('does not divide by zero before the stream has a size', () => {
    const point = normalizedPointOnVideo(500, 500, bounds, 0, 0);
    expect(point).toEqual({ x: 0.5, y: 0.5 });
  });
});
