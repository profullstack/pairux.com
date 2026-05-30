import { describe, it, expect } from 'vitest';
import { getContainRect, clamp } from './containRect';

describe('getContainRect', () => {
  it('letterboxes a 16:9 video inside a taller container', () => {
    // 16:9 content inside a 1000x1000 box -> width-bound, centered vertically.
    const rect = getContainRect(1000, 1000, 1920, 1080);
    expect(rect.width).toBeCloseTo(1000, 6);
    expect(rect.height).toBeCloseTo(562.5, 1);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(218.75, 1);
  });

  it('pillarboxes a 16:9 video inside a wider container', () => {
    // 16:9 content inside a 2000x500 box -> height-bound, centered horizontally.
    const rect = getContainRect(2000, 500, 1920, 1080);
    expect(rect.height).toBe(500);
    expect(rect.width).toBeCloseTo(888.9, 1);
    expect(rect.y).toBe(0);
    expect(rect.x).toBeCloseTo(555.6, 1);
  });

  it('fills the container exactly when aspect ratios match', () => {
    const rect = getContainRect(1920, 1080, 1920, 1080);
    expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('falls back to the container rect for invalid dimensions', () => {
    expect(getContainRect(800, 600, 0, 0)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(getContainRect(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('clamp', () => {
  it('clamps within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
