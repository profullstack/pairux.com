import type { InputEvent, InputBackend } from '../types.js';

interface UnsupportedWaylandBackendOptions {
  reason?: string;
  details?: Record<string, unknown>;
}

export class UnsupportedWaylandInputBackend implements InputBackend {
  readonly name = 'wayland-unsupported';
  readonly supported = false;
  readonly reason: string;
  readonly details: Record<string, unknown> | undefined;

  private warned = false;

  constructor(options: UnsupportedWaylandBackendOptions = {}) {
    this.reason =
      options.reason ??
      'Wayland mouse/keyboard injection is not available on this host. PairUX requires xdg-desktop-portal RemoteDesktop support from the active compositor; log in to a supported KDE Plasma Wayland or X11 session and try again. The legacy ydotool backend is diagnostic-only and is never enabled automatically.';
    this.details = options.details;
  }

  init(): Promise<undefined> {
    if (!this.warned) {
      this.warned = true;
      console.warn('[InputInjector] Wayland backend unavailable:', {
        reason: this.reason,
        details: this.details,
      });
    }
    return Promise.resolve(undefined);
  }

  updateScreenSize(_width: number, _height: number): void {
    // No-op until Wayland backend is implemented.
  }

  inject(_event: InputEvent): Promise<void> {
    return Promise.reject(new Error(this.reason));
  }

  emergencyStop(): Promise<void> {
    // No-op for unsupported backend.
    return Promise.resolve();
  }
}
