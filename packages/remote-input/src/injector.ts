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
import type {
  InputBackend,
  InputDiagnostics,
  InputEvent,
  InputStats,
  MouseButton,
  MouseInputEvent,
} from './types.js';

export interface RemoteInputInjectorOptions {
  /** Which OS backend to use. Detected from the current process by default. */
  selection?: InputBackendSelection;
  /** Override backend construction, e.g. to inject a fake in tests. */
  createBackend?: (selection: InputBackendSelection) => InputBackend;
  /** Ceiling on events per second reaching the OS. Defaults to 1000. */
  maxEventsPerSecond?: number;
  /**
   * How long a button or key may stay held with no further input before it
   * is force-released. Guards against a viewer dropping mid-drag. Default 5s.
   */
  holdTimeoutMs?: number;
  /**
   * Keep the local and remote cursors independent (default true).
   *
   * Remote movement then drives only a tracked position rather than the real
   * pointer, which is borrowed just long enough to place a click and handed
   * back. Set false to have remote input drive the system cursor directly.
   *
   * A drag is the exception in either mode: once a button is held, the motion
   * has to reach the OS or the drag tears (see `dispatch`).
   */
  virtualCursor?: boolean;
  /**
   * Inset, in pixels, applied to injected pointer coordinates so remote input
   * cannot land exactly on a screen edge or corner. Defaults to 0 (no inset).
   *
   * Exists because compositor hot-corners — GNOME's Activities corner above
   * all — fire from the corner pixel, and a guest brushing it hijacks the
   * host's desktop. Costs the outermost pixels of clickable area, so callers
   * opt in only on the platforms that need it.
   */
  edgeMarginPx?: number;
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

  // What this injector is currently holding down on the host. Tracked so it
  // can always be released — a button left down puts the desktop into a
  // permanent drag that looks like a total input freeze to the host user.
  private readonly heldButtons = new Set<MouseButton>();
  private readonly heldKeys = new Set<string>();
  private holdWatchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly holdTimeoutMs: number;

  // Two-cursor mode: remote movement never moves the local pointer, so both
  // people keep a usable cursor at the same time.
  private readonly virtualCursor: boolean;
  private readonly edgeMarginPx: number;
  /** Last known host screen size, used to convert `edgeMarginPx` to 0-1. */
  private screenSize: { width: number; height: number } | null = null;
  private remotePosition = { x: 0.5, y: 0.5 };
  /** Where the local pointer was before a remote click borrowed it. */
  private borrowedFrom: { x: number; y: number } | null = null;

  constructor(options: RemoteInputInjectorOptions = {}) {
    this.selection = options.selection ?? getInputBackendSelection();
    this.makeBackend = options.createBackend ?? createInputBackend;
    this.rateLimiter = new InputRateLimiter(options.maxEventsPerSecond ?? 1000);
    this.holdTimeoutMs = options.holdTimeoutMs ?? 5000;
    this.virtualCursor = options.virtualCursor ?? true;
    this.edgeMarginPx = Math.max(0, options.edgeMarginPx ?? 0);
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
        this.screenSize = { width: result.screenWidth, height: result.screenHeight };
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

    // Start cursor reporting so we can restore the host pointer after
    // remote clicks.  On platforms without it (Wayland without KWin) the
    // pointer stays where the click landed — same as TeamViewer.
    if (this.virtualCursor) {
      void backend.startCursorReporting?.().catch((error: unknown) => {
        this.logger.warn('[RemoteInput] Cursor reporting could not start', { error });
      });
    }

    this.logger.log('[RemoteInput] Injection enabled', { backend: backend.name });
    return true;
  }

  disable(): void {
    this.enabled = false;
    // Anything still held must come back up, or the host is left mid-drag with
    // a physically stuck button and no way to recover short of a reboot.
    void this.releaseAll('injection disabled');
    this.logger.log('[RemoteInput] Injection disabled');
  }

  /**
   * Send an "up" for everything this injector is holding down.
   *
   * Deliberately bypasses the enabled/rate-limit gates: releasing is always
   * safe, and the common reason to release is that control has just been
   * switched off.
   */
  async releaseAll(reason: string): Promise<void> {
    const buttons = [...this.heldButtons];
    const keys = [...this.heldKeys];
    this.heldButtons.clear();
    this.heldKeys.clear();
    this.clearHoldWatchdog();

    if (buttons.length === 0 && keys.length === 0) return;

    this.logger.warn('[RemoteInput] Releasing stuck input', { reason, buttons, keys });

    const backend = this.getBackend();

    for (const button of buttons) {
      try {
        await backend.inject({ type: 'mouse', action: 'up', button, x: 0.5, y: 0.5 });
      } catch (error) {
        this.logger.error('[RemoteInput] Failed to release button', { button, error });
      }
    }

    await this.restoreLocalPointer();

    for (const key of keys) {
      try {
        await backend.inject({
          type: 'keyboard',
          action: 'up',
          key,
          code: key,
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        });
      } catch (error) {
        this.logger.error('[RemoteInput] Failed to release key', { key, error });
      }
    }
  }

  /**
   * Put the event on the OS.
   *
   * In two-cursor mode (`virtualCursor`, the default) remote *movement* only
   * advances a tracked position; the host's pointer is left alone so both
   * people keep a usable cursor. The real pointer is borrowed for the instant
   * a click or scroll needs to land somewhere, then handed back.
   *
   * A drag is the exception. There is only one real cursor, so once a remote
   * button is held the motion has to reach the OS — otherwise a drag becomes
   * "press at A, teleport, release at B" and anything that tracks intermediate
   * motion (text selection, canvas apps, HTML5 drag-and-drop, file managers)
   * never sees the drag at all. The pointer is handed back once everything is
   * released.
   *
   * With `virtualCursor: false` every mouse event drives the system cursor
   * directly, which is the classic single-cursor remote-control behaviour.
   */
  private async dispatch(event: InputEvent): Promise<void> {
    // Keyboard events go straight to the OS; they never move the cursor.
    //
    // Deliberately not logged. This is the host's own typing — passwords
    // included — and `key`/`code` in a log file is a keylogger by any other
    // name. The counts in `getDiagnostics()` cover the debugging need.
    if (event.type === 'keyboard') {
      await this.getBackend().inject(event);
      return;
    }

    const backend = this.getBackend();
    const dragging = this.heldButtons.size > 0;

    if (event.action === 'move') {
      this.remotePosition = { x: event.x, y: event.y };

      // Virtual by default, but a drag in progress needs the real motion.
      if (this.virtualCursor && !dragging) return;

      await backend.inject(this.withEdgeMargin(event));
      return;
    }

    // Click / scroll: inject at the remote position.
    this.remotePosition = { x: event.x, y: event.y };

    // Borrow the real pointer, unless a previous press already borrowed it.
    if (!dragging) {
      this.borrowedFrom ??= (await backend.getCursorPosition?.()) ?? null;
    }

    await backend.inject(this.withEdgeMargin(event));

    // Hold the pointer in place for the duration of a drag. Held state is
    // recorded after dispatch, so fold this event in to see what remains down.
    const remaining = new Set(this.heldButtons);
    if (event.action === 'down') remaining.add(event.button);
    else if (event.action === 'up') remaining.delete(event.button);
    if (remaining.size > 0) return;

    await this.restoreLocalPointer();
  }

  /**
   * Nudge coordinates off the screen edge when `edgeMarginPx` is configured.
   *
   * Returns the event untouched when there is no margin or no known screen
   * size, so the default build injects exactly what the guest sent.
   */
  private withEdgeMargin<T extends MouseInputEvent>(event: T): T {
    if (this.edgeMarginPx === 0 || !this.screenSize) return event;

    const marginX = this.edgeMarginPx / this.screenSize.width;
    const marginY = this.edgeMarginPx / this.screenSize.height;
    // A margin wider than half the screen would invert the range.
    if (marginX >= 0.5 || marginY >= 0.5) return event;

    const x = Math.min(1 - marginX, Math.max(marginX, event.x));
    const y = Math.min(1 - marginY, Math.max(marginY, event.y));
    if (x === event.x && y === event.y) return event;

    return { ...event, x, y };
  }

  private async restoreLocalPointer(): Promise<void> {
    const origin = this.borrowedFrom;
    this.borrowedFrom = null;
    if (!origin) return;

    try {
      await this.getBackend().inject({
        type: 'mouse',
        action: 'move',
        x: origin.x,
        y: origin.y,
      });
    } catch (error) {
      this.logger.warn('[RemoteInput] Could not restore local pointer', { error });
    }
  }

  /** Where the remote participant's cursor currently sits, normalized 0-1. */
  getRemoteCursorPosition(): { x: number; y: number } {
    return { ...this.remotePosition };
  }

  private clearHoldWatchdog(): void {
    if (this.holdWatchdog !== null) {
      clearTimeout(this.holdWatchdog);
      this.holdWatchdog = null;
    }
  }

  /**
   * While something is held, arm a timer to release it if no further input
   * arrives. A viewer whose connection drops mid-drag would otherwise leave
   * the button down indefinitely.
   */
  private armHoldWatchdog(): void {
    this.clearHoldWatchdog();
    if (this.heldButtons.size === 0 && this.heldKeys.size === 0) return;

    this.holdWatchdog = setTimeout(() => {
      void this.releaseAll('no input while a button or key was held');
    }, this.holdTimeoutMs);
    // Never keep a Node process alive just for this timer.
    this.holdWatchdog.unref();
  }

  private trackHeldState(event: InputEvent): void {
    if (event.type === 'mouse') {
      if (event.action === 'down') this.heldButtons.add(event.button);
      else if (event.action === 'up') this.heldButtons.delete(event.button);
    } else if (event.action === 'down') {
      this.heldKeys.add(event.code);
    } else if (event.action === 'up') {
      this.heldKeys.delete(event.code);
    }

    this.armHoldWatchdog();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  updateScreenSize(width: number, height: number): void {
    this.screenSize = { width, height };
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
      await this.dispatch(event);
      this.stats.injected += 1;
      this.trackHeldState(event);
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
    this.enabled = false;
    await this.releaseAll('emergency stop');

    try {
      await this.getBackend().emergencyStop();
    } catch (error) {
      this.logger.error('[RemoteInput] Error during emergency stop:', error);
    }
  }

  /**
   * Shut down for good: stop accepting input, let go of anything held, and
   * release whatever the backend installed on the system.
   */
  async dispose(): Promise<void> {
    this.enabled = false;
    await this.releaseAll('shutting down');
    this.clearHoldWatchdog();

    try {
      await this.backend?.dispose?.();
    } catch (error) {
      this.logger.warn('[RemoteInput] Backend cleanup failed', { error });
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
