import { afterEach, describe, expect, it } from 'vitest';
import { isInputDebugEnabled } from './debug.js';

describe('isInputDebugEnabled', () => {
  const original = process.env.PAIRUX_DEBUG_INPUT;

  afterEach(() => {
    if (original === undefined) delete process.env.PAIRUX_DEBUG_INPUT;
    else process.env.PAIRUX_DEBUG_INPUT = original;
  });

  // The tracing prints the coordinates of everything the remote peer clicks
  // and costs a window-server round trip per button event, so silence has to
  // be the default rather than something a build flag happens to give us.
  it('is off unless explicitly enabled', () => {
    delete process.env.PAIRUX_DEBUG_INPUT;
    expect(isInputDebugEnabled()).toBe(false);
  });

  it('is on for exactly "1"', () => {
    process.env.PAIRUX_DEBUG_INPUT = '1';
    expect(isInputDebugEnabled()).toBe(true);
  });

  // Anything truthy-looking but not "1" stays off, so a stray value in a shell
  // profile cannot quietly turn tracing on in a packaged build.
  it('ignores other values', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      process.env.PAIRUX_DEBUG_INPUT = value;
      expect(isInputDebugEnabled()).toBe(false);
    }
  });
});
