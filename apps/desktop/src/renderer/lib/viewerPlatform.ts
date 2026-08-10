/**
 * Which modifier this machine uses for keyboard shortcuts.
 *
 * Needed when acting as a viewer, because the host may be on a different OS:
 * "the shortcut key" is Cmd on macOS and Ctrl everywhere else, and only the
 * viewer knows which one the user actually pressed. See `modifiersFromDomEvent`.
 */

export type AccelPlatform = 'darwin' | 'other';

/** Pure so the mapping is testable without a window. */
export function accelPlatformFor(platform: string | undefined | null): AccelPlatform {
  return platform === 'darwin' ? 'darwin' : 'other';
}

/**
 * Read the platform from preload rather than sniffing the user agent.
 *
 * Falls back to 'other' outside Electron, which is also the right answer for a
 * plain browser on anything but a Mac — and a wrong shortcut modifier is a
 * better failure than throwing on render.
 */
export function getAccelPlatform(): AccelPlatform {
  const api = (globalThis as { electronAPI?: { platform?: string } }).electronAPI;
  return accelPlatformFor(api?.platform);
}
