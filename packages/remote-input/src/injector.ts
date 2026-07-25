/**
 * The object a host app talks to: an explicitly gated, rate-limited,
 * validated path from a remote input event to the local OS.
 *
 * Injection is off until `enable()` is called, and `enable()` refuses when the
 * selected backend cannot actually drive this machine — so a host never
 * believes it granted control that silently does nothing.
 */

import {
  createInputBackend,
  getInputBackendSelection,
  type InputBackendSelection,
} from './factory.js';
import { InputRateLimiter, validateInputEvent, type RejectionReason } from './safety.js';
import type { InputBackend, InputDiagnostics, InputEvent, InputStats } from './types.js';

export interface RemoteInputInjectorOptions {
  /** Which OS backend to use. Detected from the current process by default. */
  selection?: InputBackendSelection;
  /** Override backend construction, e.g. to inject a fake in tests. */
  createBackend?: (selection: InputBackendSelection) => InputBackend;
  /** Ceiling on events per second reaching the OS. Defaults to 1000. */
  maxEventsPerSecond?: number;
  /** Called when an event is refused, for host-side logging or telemetry. */
  onRejected?: (reason: RejectionReason, event: InputEvent, detail?: string) => void;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class RemoteInputInjector {
  private backend: InputBackend | null = null;
  private enabled = false;
  private readonly selection: InputBackendSelection;
  private readonly makeBackend: (selection: InputBackendSelection) => InputBackend;
  private readonly rateLimiter: InputRateLimiter;
  private readonly onRejected: RemoteInputInjectorOptions['onRejected'];
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly stats: InputStats = { received: 0, injected: 0, rejected: 0, errors: 0 };

  constructor(options: RemoteInputInjectorOptions = {}) {
    this.selection = options.selection ?? getInputBackendSelection();
    this.makeBackend = options.createBackend ?? createInputBackend;
    this.rateLimiter = new InputRateLimiter(options.maxEventsPerSecond ?? 1000);
    this.onRejected = options.onRejected;
    this.logger = options.logger ?? console;
  }

  /** Constructed lazily so selection never runs at import time. */
  private getBackend(): InputBackend {
    this.backend ??= this.makeBackend(this.selection);
    return this.backend;
  }

  get backendName(): string {
    return this.getBackend().name;
  }

  get isSupported(): boolean {
    return this.getBackend().supported;
  }

  async init(): Promise<void> {
    try {
      const backend = this.getBackend();
      const result = await backend.init();

      if (result?.screenWidth && result.screenHeight) {
        this.logger.log(
          `[RemoteInput] Screen size: ${String(result.screenWidth)}x${String(result.screenHeight)}`
        );
      }
    } catch (error) {
      this.logger.error('[RemoteInput] Failed to initialize backend:', error);
    }
  }

  /**
   * Turn injection on. Returns false when the backend cannot inject on this
   * host, which the caller should surface rather than ignore.
   */
  enable(): boolean {
    const backend = this.getBackend();

    if (!backend.supported) {
      this.enabled = false;
      this.logger.warn('[RemoteInput] Cannot enable injection: backend unsupported', {
        backend: backend.name,
        reason: backend.reason,
      });
      return false;
    }

    this.enabled = true;
    this.rateLimiter.reset();
    this.logger.log('[RemoteInput] Injection enabled', { backend: backend.name });
    return true;
  }

  disable(): void {
    this.enabled = false;
    this.logger.log('[RemoteInput] Injection disabled');
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  updateScreenSize(width: number, height: number): void {
    this.getBackend().updateScreenSize(width, height);
  }

  private reject(reason: RejectionReason, event: InputEvent, detail?: string): void {
    this.stats.rejected += 1;
    this.onRejected?.(reason, event, detail);
  }

  async inject(event: InputEvent): Promise<void> {
    this.stats.received += 1;

    if (!this.enabled) {
      this.reject('not-enabled', event, 'control is not granted');
      return;
    }

    const validation = validateInputEvent(event);
    if (!validation.ok) {
      // reason is always set when ok is false
      this.reject(validation.reason ?? 'invalid-key', event, validation.detail);
      this.logger.warn('[RemoteInput] Refused event', {
        reason: validation.reason,
        detail: validation.detail,
      });
      return;
    }

    if (!this.rateLimiter.shouldAllow()) {
      this.reject('rate-limited', event, 'event rate ceiling exceeded');
      return;
    }

    try {
      await this.getBackend().inject(event);
      this.stats.injected += 1;
    } catch (error) {
      this.stats.errors += 1;
      this.logger.error('[RemoteInput] Failed to inject event:', {
        backend: this.getBackend().name,
        type: event.type,
        action: 'action' in event ? event.action : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Disable injection and release every key and button the remote peer may
   * still be holding. Called on panic hotkeys and on disconnect, so a dropped
   * connection cannot leave a modifier stuck down.
   */
  async emergencyStop(): Promise<void> {
    this.logger.log('[RemoteInput] Emergency stop');
    this.disable();

    try {
      await this.getBackend().emergencyStop();
    } catch (error) {
      this.logger.error('[RemoteInput] Error during emergency stop:', error);
    }
  }

  getDiagnostics(): InputDiagnostics {
    const backend = this.getBackend();
    const diagnostics: InputDiagnostics = {
      enabled: this.enabled,
      backend: backend.name,
      backendSupported: backend.supported,
      stats: { ...this.stats },
    };

    if (backend.reason !== undefined) diagnostics.reason = backend.reason;
    if (backend.details !== undefined) diagnostics.details = backend.details;

    return diagnostics;
  }
}
