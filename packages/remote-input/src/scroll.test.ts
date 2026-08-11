import { describe, expect, it } from 'vitest';
import {
  ScrollAccumulator,
  deltaToNotches,
  DELTA_MODE_LINE,
  DELTA_MODE_PAGE,
  DELTA_MODE_PIXEL,
} from './scroll.js';

describe('deltaToNotches', () => {
  it('reads a wheel notch as one notch', () => {
    expect(deltaToNotches(100, DELTA_MODE_PIXEL)).toBe(1);
    expect(deltaToNotches(-100, DELTA_MODE_PIXEL)).toBe(-1);
  });

  it('treats a missing deltaMode as pixels', () => {
    expect(deltaToNotches(100)).toBe(1);
  });

  it('scales line and page deltas', () => {
    expect(deltaToNotches(3, DELTA_MODE_LINE)).toBeCloseTo(0.99);
    expect(deltaToNotches(1, DELTA_MODE_PAGE)).toBe(3);
  });

  it('ignores a non-finite delta rather than injecting NaN notches', () => {
    expect(deltaToNotches(Number.NaN)).toBe(0);
    expect(deltaToNotches(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('ScrollAccumulator', () => {
  // The bug: a trackpad reports the pixels your fingers moved, not notches.
  // Rounding each 3px event and forcing a minimum of one notch turned a gentle
  // two-finger drag into a burst of hard wheel clicks on the host.
  it('adds up a trackpad’s small deltas instead of firing a notch for each', () => {
    const scroll = new ScrollAccumulator();
    const notches: number[] = [];

    // Thirty 3px events: 90px of movement, which is not quite one notch.
    for (let i = 0; i < 30; i += 1) notches.push(scroll.add(3, DELTA_MODE_PIXEL));

    const total = notches.reduce((sum, n) => sum + n, 0);
    expect(total).toBe(0);
    // And the next few events tip it over, rather than nothing ever happening.
    expect(scroll.add(30, DELTA_MODE_PIXEL)).toBe(1);
  });

  it('leaves a real mouse wheel exactly as it was', () => {
    const scroll = new ScrollAccumulator();
    expect(scroll.add(100)).toBe(1);
    expect(scroll.add(100)).toBe(1);
    expect(scroll.add(-100)).toBe(-1);
  });

  it('carries the remainder across events', () => {
    const scroll = new ScrollAccumulator();
    expect(scroll.add(60)).toBe(0);
    expect(scroll.add(60)).toBe(1);
    // 20px of carry left over, so 90 more crosses the next notch.
    expect(scroll.add(90)).toBe(1);
  });

  // Truncating toward zero rather than flooring: a leftover fraction pointing
  // one way must not emit a notch the other way when the user reverses.
  it('does not emit a notch in the wrong direction when reversing', () => {
    const scroll = new ScrollAccumulator();
    // Half a notch down, then back up through zero: no notch either way until
    // a full one has accumulated in the new direction.
    expect(scroll.add(50)).toBe(0);
    expect(scroll.add(-30)).toBe(0);
    expect(scroll.add(-40)).toBe(0);
    expect(scroll.add(-100)).toBe(-1);
  });

  it('emits several notches for one fast flick', () => {
    const scroll = new ScrollAccumulator();
    expect(scroll.add(350)).toBe(3);
  });

  it('drops the partial notch on reset', () => {
    const scroll = new ScrollAccumulator();
    scroll.add(90);
    scroll.reset();
    expect(scroll.add(90)).toBe(0);
  });
});
