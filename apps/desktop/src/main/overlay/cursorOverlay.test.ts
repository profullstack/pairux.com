import { describe, expect, it } from 'vitest';
import { canShowDesktopOverlay } from './cursorOverlay';

// The overlay is a fullscreen, always-on-top window over the host's real
// desktop. If it fails to be inert it takes input the host cannot get back,
// which is the most damaging failure this app has. So the question is not
// "does click-through usually work" but "can we show it without taking focus
// at all" — and on Wayland Electron documents showInactive() as unsupported.
describe('canShowDesktopOverlay', () => {
  it('refuses Wayland, where showInactive is unsupported', () => {
    expect(canShowDesktopOverlay('wayland')).toBe(false);
  });

  it('allows the display servers whose window APIs Electron supports', () => {
    expect(canShowDesktopOverlay('x11')).toBe(true);
    expect(canShowDesktopOverlay('macos')).toBe(true);
    expect(canShowDesktopOverlay('windows')).toBe(true);
  });

  // An unknown display server is only reported on Linux when neither
  // WAYLAND_DISPLAY nor DISPLAY is set — a headless or unusual session rather
  // than a compositor known to mishandle the window.
  it('allows an unknown display server', () => {
    expect(canShowDesktopOverlay('unknown')).toBe(true);
  });
});
