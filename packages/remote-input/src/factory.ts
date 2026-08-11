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
 * On Wayland, use the compositor-approved RemoteDesktop portal first. Raw
 * /dev/uinput injection is deliberately never selected automatically: a
 * daemon that says it accepted a command cannot prove KWin honoured it, and a
 * lost release can strand the host's physical input. Administrators may opt
 * into the legacy ydotool path while diagnosing older desktops.
 */
function createWaylandBackend(): InputBackend {
  const portalBackend = new WaylandPortalInputBackend();

  if (portalBackend.supported) return portalBackend;

  const ydotoolBackend = new WaylandYdotoolInputBackend();
  if (process.env.PAIRUX_WAYLAND_INPUT_BACKEND === 'ydotool' && ydotoolBackend.supported) {
    return ydotoolBackend;
  }

  return new UnsupportedWaylandInputBackend({
    reason:
      portalBackend.reason ??
      'Wayland remote input requires the approved XDG RemoteDesktop portal on this host. ' +
        'The legacy ydotool backend is disabled by default because it cannot verify compositor input.',
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
        optInEnvironment: 'PAIRUX_WAYLAND_INPUT_BACKEND=ydotool',
      },
    },
  });
}
