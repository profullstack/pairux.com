/**
 * Backend selection.
 *
 * Platform and display server are parameters rather than ambient reads so a
 * host can override them (and tests can drive every OS from one machine).
 */

import { detectDisplayServer } from './platform.js';
import { NutJsInputBackend } from './backends/nutjs.js';
import { UnsupportedWaylandInputBackend } from './backends/unsupportedWayland.js';
import { WaylandPortalInputBackend } from './backends/waylandPortal.js';
import { WaylandYdotoolInputBackend } from './backends/waylandYdotool.js';
import type { DisplayServer, InputBackend, Platform } from './types.js';

export type InputBackendKind =
  | 'nut-js'
  | 'wayland-portal'
  | 'wayland-ydotool'
  | 'wayland-unsupported';

export interface InputBackendSelection {
  kind: InputBackendKind;
  platform: Platform;
  displayServer: DisplayServer;
}

/**
 * nut.js drives macOS, Windows and Linux/X11. Wayland refuses synthetic input
 * from ordinary clients, so it gets its own resolution path.
 */
export function selectInputBackend(
  platform: Platform,
  displayServer: DisplayServer
): InputBackendKind {
  if (platform === 'linux' && displayServer === 'wayland') {
    return 'wayland-portal';
  }
  return 'nut-js';
}

export function getInputBackendSelection(
  platform: Platform = process.platform,
  displayServer: DisplayServer = detectDisplayServer(platform)
): InputBackendSelection {
  return {
    kind: selectInputBackend(platform, displayServer),
    platform,
    displayServer,
  };
}

export function createInputBackend(selection = getInputBackendSelection()): InputBackend {
  if (selection.platform === 'linux' && selection.displayServer === 'wayland') {
    return createWaylandBackend();
  }

  switch (selection.kind) {
    case 'wayland-portal':
      return new WaylandPortalInputBackend();
    case 'wayland-ydotool':
      return new WaylandYdotoolInputBackend();
    case 'wayland-unsupported':
      return new UnsupportedWaylandInputBackend();
    case 'nut-js':
    default:
      return new NutJsInputBackend();
  }
}

/**
 * Wayland has no single answer, so probe in order of how well each option
 * actually works and fall back to a backend whose only job is to explain why
 * control is unavailable.
 */
function createWaylandBackend(): InputBackend {
  const portalBackend = new WaylandPortalInputBackend();

  const ydotoolBackend = new WaylandYdotoolInputBackend();
  const ydotoolDetails = ydotoolBackend.details as { hasYdotoolBinary?: boolean } | undefined;
  if (ydotoolBackend.supported || ydotoolDetails?.hasYdotoolBinary) {
    return ydotoolBackend;
  }

  // If the portal is present, surface portal-specific diagnostics in the UI.
  const portalDetails = portalBackend.details as { portalDesktopAvailable?: boolean } | undefined;
  if (portalDetails?.portalDesktopAvailable) {
    return portalBackend;
  }

  return new UnsupportedWaylandInputBackend({
    reason:
      ydotoolBackend.reason ??
      portalBackend.reason ??
      'Wayland remote input backend is unavailable on this host.',
    details: {
      portal: {
        backend: portalBackend.name,
        reason: portalBackend.reason,
        details: portalBackend.details,
      },
      ydotool: {
        backend: ydotoolBackend.name,
        reason: ydotoolBackend.reason,
        details: ydotoolBackend.details,
      },
    },
  });
}
