import { detectDisplayServer, type DisplayServer } from '../platform';
import { NutJsInputBackend } from './backends/nutJsBackend';
import type { InputBackend } from './backends/types';
import { UnsupportedWaylandInputBackend } from './backends/unsupportedWaylandBackend';
import { WaylandPortalInputBackend } from './backends/waylandPortalBackend';
import { WaylandYdotoolInputBackend } from './backends/waylandYdotoolBackend';

export type InputBackendKind =
  | 'nut-js'
  | 'wayland-portal'
  | 'wayland-ydotool'
  | 'wayland-unsupported';

export interface InputBackendSelection {
  kind: InputBackendKind;
  platform: NodeJS.Platform;
  displayServer: DisplayServer;
}

export function selectInputBackend(
  platform: NodeJS.Platform,
  displayServer: DisplayServer
): InputBackendKind {
  if (platform === 'linux' && displayServer === 'wayland') {
    return 'wayland-portal';
  }
  return 'nut-js';
}

export function getInputBackendSelection(
  platform: NodeJS.Platform = process.platform,
  displayServer: DisplayServer = detectDisplayServer()
): InputBackendSelection {
  return {
    kind: selectInputBackend(platform, displayServer),
    platform,
    displayServer,
  };
}

export function createInputBackend(selection = getInputBackendSelection()): InputBackend {
  if (selection.platform === 'linux' && selection.displayServer === 'wayland') {
    const portalBackend = new WaylandPortalInputBackend();

    const ydotoolBackend = new WaylandYdotoolInputBackend();
    const ydotoolDetails = ydotoolBackend.details as { hasYdotoolBinary?: boolean } | undefined;
    if (ydotoolBackend.supported || ydotoolDetails?.hasYdotoolBinary) {
      return ydotoolBackend;
    }

    // If portal is present, surface portal-specific diagnostics/reason in the UI.
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
