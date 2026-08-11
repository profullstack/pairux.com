import { describe, expect, it } from 'vitest';
import { resolveCaptureBounds } from './captureBounds.js';

const primary = { x: 0, y: 0, width: 1920, height: 1080 };

describe('resolveCaptureBounds', () => {
  it('maps the primary display onto itself', () => {
    expect(
      resolveCaptureBounds({
        display: primary,
        primary,
        backendPrimary: { width: 1920, height: 1080 },
      })
    ).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  // The bug. A host sharing the monitor to their right sent the guest a picture
  // of that screen while every click went to the primary one, because 0-1
  // coordinates were mapped onto the primary display's rectangle regardless of
  // what was actually being shared.
  it('offsets a second monitor by where it sits on the desktop', () => {
    const second = { x: 1920, y: 0, width: 2560, height: 1440 };

    expect(
      resolveCaptureBounds({
        display: second,
        primary,
        backendPrimary: { width: 1920, height: 1080 },
      })
    ).toEqual({ x: 1920, y: 0, width: 2560, height: 1440 });
  });

  it('handles a monitor placed to the left, at negative coordinates', () => {
    const left = { x: -1280, y: 0, width: 1280, height: 1024 };

    expect(
      resolveCaptureBounds({
        display: left,
        primary,
        backendPrimary: { width: 1920, height: 1080 },
      })
    ).toEqual({ x: -1280, y: 0, width: 1280, height: 1024 });
  });

  // The other half of the same problem, and the shape of an earlier regression:
  // a Retina Mac reports 1440x900 logical while the backend positions the
  // pointer in 2880x1800 physical pixels. Mapping the logical rectangle in
  // unscaled put the centre of the screen at the bottom-right corner.
  it('scales into the backend’s coordinate space when they differ', () => {
    const retina = { x: 0, y: 0, width: 1440, height: 900 };

    expect(
      resolveCaptureBounds({
        display: retina,
        primary: retina,
        backendPrimary: { width: 2880, height: 1800 },
      })
    ).toEqual({ x: 0, y: 0, width: 2880, height: 1800 });
  });

  it('scales a second monitor’s offset too, not just its size', () => {
    const second = { x: 1440, y: 0, width: 1440, height: 900 };

    expect(
      resolveCaptureBounds({
        display: second,
        primary: { x: 0, y: 0, width: 1440, height: 900 },
        backendPrimary: { width: 2880, height: 1800 },
      })
    ).toEqual({ x: 2880, y: 0, width: 2880, height: 1800 });
  });

  it('refuses a degenerate rectangle rather than injecting into it', () => {
    expect(
      resolveCaptureBounds({
        display: { x: 0, y: 0, width: 0, height: 1080 },
        primary,
        backendPrimary: { width: 1920, height: 1080 },
      })
    ).toBeNull();

    expect(
      resolveCaptureBounds({
        display: primary,
        primary,
        backendPrimary: { width: 0, height: 0 },
      })
    ).toBeNull();
  });
});
