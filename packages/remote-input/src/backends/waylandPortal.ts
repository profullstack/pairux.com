import { execFileSync } from 'child_process';
import type { InputEvent, InputBackend, InputBackendInitResult } from '../types.js';

export interface WaylandPortalProbe {
  hasDbusSession: boolean;
  hasGdbus: boolean;
  portalDesktopAvailable: boolean;
  portalDesktopOwned?: boolean;
  portalDesktopName?: string;
  portalImplDetected?: string | null;
  currentDesktop?: string;
  error?: string;
}

type NameHasOwnerRunner = (busName: string) => boolean;

function hasGdbusBinary(): boolean {
  try {
    execFileSync('gdbus', ['help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function defaultNameHasOwner(busName: string): boolean {
  const output = execFileSync(
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.NameHasOwner',
      busName,
    ],
    { encoding: 'utf8', timeout: 1500 }
  );

  return /\btrue\b/i.test(output);
}

export function probeWaylandPortalSupport(
  nameHasOwner: NameHasOwnerRunner = defaultNameHasOwner
): WaylandPortalProbe {
  const currentDesktop =
    process.env.XDG_CURRENT_DESKTOP ??
    process.env.DESKTOP_SESSION ??
    process.env.GDMSESSION ??
    'unknown';
  const hasDbusSession = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
  const hasGdbus = hasGdbusBinary();

  const probe: WaylandPortalProbe = {
    hasDbusSession,
    hasGdbus,
    portalDesktopAvailable: false,
    currentDesktop,
  };

  if (!hasDbusSession) {
    probe.error = 'DBUS_SESSION_BUS_ADDRESS is not set';
    return probe;
  }

  if (!hasGdbus) {
    probe.error = '`gdbus` is required to probe xdg-desktop-portal';
    return probe;
  }

  try {
    const portalDesktopOwned = nameHasOwner('org.freedesktop.portal.Desktop');
    probe.portalDesktopOwned = portalDesktopOwned;
    probe.portalDesktopName = 'org.freedesktop.portal.Desktop';
    probe.portalDesktopAvailable = portalDesktopOwned;

    const implCandidates = [
      'org.freedesktop.impl.portal.desktop.kde',
      'org.freedesktop.impl.portal.desktop.gnome',
      'org.freedesktop.impl.portal.desktop.wlr',
      'org.freedesktop.impl.portal.desktop.hyprland',
    ];

    for (const candidate of implCandidates) {
      if (nameHasOwner(candidate)) {
        probe.portalImplDetected = candidate;
        break;
      }
    }

    if (!probe.portalDesktopAvailable) {
      probe.error = 'xdg-desktop-portal (org.freedesktop.portal.Desktop) is not running';
    }
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
  }

  return probe;
}

export class WaylandPortalInputBackend implements InputBackend {
  readonly name = 'wayland-portal';
  readonly supported = false;
  readonly reason: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  private warned = false;

  constructor(probe: WaylandPortalProbe = probeWaylandPortalSupport()) {
    this.details = {
      hasDbusSession: probe.hasDbusSession,
      hasGdbus: probe.hasGdbus,
      portalDesktopAvailable: probe.portalDesktopAvailable,
      portalDesktopOwned: probe.portalDesktopOwned,
      portalDesktopName: probe.portalDesktopName,
      portalImplDetected: probe.portalImplDetected ?? null,
      currentDesktop: probe.currentDesktop,
      probeError: probe.error,
      implemented: false,
    };

    if (!probe.hasDbusSession) {
      this.reason = 'Wayland portal backend requires a DBus session to access xdg-desktop-portal.';
    } else if (!probe.hasGdbus) {
      this.reason = 'Wayland portal backend probe requires `gdbus` (glib2).';
    } else if (!probe.portalDesktopAvailable) {
      this.reason =
        'Wayland portal backend requires xdg-desktop-portal to be running in the desktop session.';
    } else {
      this.reason =
        'PairUX detected xdg-desktop-portal but Wayland mouse/keyboard injection via the portal is not implemented yet. Install `ydotool` and start `ydotoold` for remote control on Wayland — see https://github.com/profullstack/pairux.com/blob/master/docs/LINUX-SETUP.md#wayland-configuration';
    }
  }

  init(): Promise<InputBackendInitResult | undefined> {
    if (this.warned) return Promise.resolve(undefined);
    this.warned = true;
    console.warn('[InputInjector] Wayland portal backend probe', {
      reason: this.reason,
      details: this.details,
    });
    return Promise.resolve(undefined);
  }

  updateScreenSize(_width: number, _height: number): void {
    // Placeholder until RemoteDesktop portal session/control is implemented.
  }

  inject(_event: InputEvent): Promise<void> {
    return Promise.reject(new Error(this.reason ?? 'Wayland portal backend is unavailable'));
  }

  emergencyStop(): Promise<void> {
    // No-op until portal injection implementation exists.
    return Promise.resolve();
  }
}
