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
      'Wayland mouse/keyboard injection is not available on this host. To enable remote control: install `ydotool`, ensure `ydotoold` is running, and verify write access to `/dev/uinput`. See https://pairux.com/docs/wayland';
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
