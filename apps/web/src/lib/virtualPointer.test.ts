import { describe, expect, it } from 'vitest';
import { advanceVirtualPointer } from './virtualPointer';

const centre = { x: 0.5, y: 0.5 };

describe('advanceVirtualPointer', () => {
  it('converts a pixel delta into a normalized one', () => {
    expect(advanceVirtualPointer(centre, 100, 50, 1000, 500)).toEqual({ x: 0.6, y: 0.6 });
  });

  it('moves back for negative deltas', () => {
    expect(advanceVirtualPointer(centre, -100, -50, 1000, 500)).toEqual({ x: 0.4, y: 0.4 });
  });

  // The whole point: pushing past the top must pin the pointer there rather
  // than stopping short or wrapping, so a menu bar can actually be reached by
  // overshooting instead of by pixel-perfect aim.
  it('pins at an edge when pushed past it', () => {
    expect(advanceVirtualPointer({ x: 0.5, y: 0.02 }, 0, -500, 1000, 500)).toEqual({
      x: 0.5,
      y: 0,
    });
  });

  it('pins at the far corner too', () => {
    expect(advanceVirtualPointer({ x: 0.99, y: 0.99 }, 900, 900, 1000, 500)).toEqual({
      x: 1,
      y: 1,
    });
  });

  // A surface with no size yet (not laid out) must not produce NaN and send
  // the host's pointer somewhere undefined.
  it('stays put when the surface has no size', () => {
    expect(advanceVirtualPointer(centre, 100, 100, 0, 0)).toEqual(centre);
  });
});
