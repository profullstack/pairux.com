import { describe, it, expect } from 'vitest';
import {
  initialIsWaylandGuess,
  isDisplayServerKnown,
  shouldShowInAppSourcePicker,
} from './capturePicker';

describe('shouldShowInAppSourcePicker', () => {
  it('shows the in-app picker on X11/Windows/macOS', () => {
    expect(shouldShowInAppSourcePicker(false)).toBe(true);
  });

  it('hides the in-app picker on Wayland', () => {
    expect(shouldShowInAppSourcePicker(true)).toBe(false);
  });

  // Regression: `isWayland` starts null while platform:info is in flight. The
  // old `!isWayland` test rendered the picker during that window, firing
  // desktopCapturer.getSources() on Wayland hosts — which failed with
  // "ScreenCastPortal failed: 2" and left an empty grid.
  it('hides the in-app picker until the display server is known', () => {
    expect(shouldShowInAppSourcePicker(null)).toBe(false);
  });
});

describe('isDisplayServerKnown', () => {
  it('is false only before platform:info answers', () => {
    expect(isDisplayServerKnown(null)).toBe(false);
    expect(isDisplayServerKnown(true)).toBe(true);
    expect(isDisplayServerKnown(false)).toBe(true);
  });
});

describe('initialIsWaylandGuess', () => {
  // Saves the "Detecting display server…" spinner flashing on every launch
  // where the answer was never in doubt.
  it('answers false immediately off Linux', () => {
    expect(initialIsWaylandGuess('darwin')).toBe(false);
    expect(initialIsWaylandGuess('win32')).toBe(false);
  });

  it('waits for platform:info on Linux', () => {
    expect(initialIsWaylandGuess('linux')).toBeNull();
  });

  // Outside Electron there is no platform to read, so guessing is not an option.
  it('waits when the platform is unavailable', () => {
    expect(initialIsWaylandGuess(null)).toBeNull();
  });
});
