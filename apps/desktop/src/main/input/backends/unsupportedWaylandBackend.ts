import type { InputEvent } from '@pairux/shared-types';
import type { InputBackend } from './types';

interface UnsupportedWaylandBackendOptions {
  reason?: string;
  details?: Record<string, unknown>;
}

export class UnsupportedWaylandInputBackend implements InputBackend {
  readonly name = 'wayland-unsupported';
  readonly supported = false;
  readonly reason: string;
  readonly details?: Record<string, unknown>;

  private warned = false;

  constructor(options: UnsupportedWaylandBackendOptions = {}) {
    this.reason =
      options.reason ??
      'Wayland remote input injection is not implemented yet. Screen sharing works, but control requires a Wayland-specific backend (portal/compositor integration).';
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
