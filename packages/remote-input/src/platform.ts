/**
 * Platform and display-server detection.
 *
 * Deliberately free of any Electron / GUI-toolkit dependency so the package
 * works in a plain Node process (CLI agent, daemon, test runner) as well as
 * inside a desktop app.
 */

import type { DisplayServer, Platform } from './types.js';

export function detectPlatform(): Platform {
  return process.platform;
}

/**
 * Which display server is in play.
 *
 * The Linux branch matters: X11 accepts synthetic input from any client, while
 * Wayland does not, so the two need entirely different backends.
 */
export function detectDisplayServer(platform: Platform = process.platform): DisplayServer {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  if (platform !== 'linux') return 'unknown';

  if (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY !== undefined) {
    return 'wayland';
  }

  if (process.env.DISPLAY !== undefined) return 'x11';

  return 'unknown';
}

/**
 * True when input injection needs extra user-granted permission that the OS
 * will not prompt for automatically on our behalf.
 *
 * macOS gates synthetic input behind Accessibility (TCC); the host app must
 * send the user to System Settings. Windows and X11 need nothing.
 */
export function requiresAccessibilityPermission(platform: Platform = process.platform): boolean {
  return platform === 'darwin';
}
