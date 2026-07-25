import { describe, it, expect } from 'vitest';
import { isDisplayServerKnown, shouldShowInAppSourcePicker } from './capturePicker';

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
