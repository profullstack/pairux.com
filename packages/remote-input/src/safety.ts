/**
 * Guards applied to every event before it reaches the OS.
 *
 * Input arrives from a remote peer, so it is untrusted even after the host has
 * approved that peer: a buggy or hostile viewer should not be able to warp the
 * cursor off-screen, saturate the event loop, or reach for a combination that
 * locks the machine or opens a privileged surface.
 */

import type { InputEvent, KeyboardInputEvent } from './types.js';

export type RejectionReason =
  | 'invalid-coordinates'
  | 'invalid-scroll'
  | 'invalid-key'
  | 'blocked-combination'
  | 'rate-limited'
  | 'not-enabled';

export interface ValidationResult {
  ok: boolean;
  reason?: RejectionReason;
  detail?: string;
}

const OK: ValidationResult = { ok: true };

function isNormalized(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Combinations refused even while control is granted.
 *
 * These either hand over a privileged surface (the secure attention sequence,
 * the macOS force-quit picker) or end the session in a way the remote peer
 * cannot undo — locking the screen or logging the host out strands them.
 */
export const BLOCKED_COMBINATIONS: {
  description: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  keys: string[];
}[] = [
  { description: 'secure attention / task manager', ctrl: true, alt: true, keys: ['Delete'] },
  { description: 'lock screen', meta: true, keys: ['l', 'L'] },
  { description: 'force quit picker', meta: true, alt: true, keys: ['Escape'] },
  { description: 'log out', ctrl: true, shift: true, meta: true, keys: ['q', 'Q'] },
];

export function isDangerousCombination(event: KeyboardInputEvent): boolean {
  const { modifiers, key } = event;

  return BLOCKED_COMBINATIONS.some((combo) => {
    if (!combo.keys.some((candidate) => candidate.toLowerCase() === key.toLowerCase())) {
      return false;
    }
    // Every modifier the combination names must be held. Extra modifiers are
    // allowed so Ctrl+Alt+Shift+Delete is blocked just like Ctrl+Alt+Delete.
    if (combo.ctrl === true && !modifiers.ctrl) return false;
    if (combo.alt === true && !modifiers.alt) return false;
    if (combo.shift === true && !modifiers.shift) return false;
    if (combo.meta === true && !modifiers.meta) return false;
    return true;
  });
}

export function validateInputEvent(event: InputEvent): ValidationResult {
  if (event.type === 'mouse') {
    if (!isNormalized(event.x) || !isNormalized(event.y)) {
      return {
        ok: false,
        reason: 'invalid-coordinates',
        detail: `expected 0-1 coordinates, got x=${String(event.x)} y=${String(event.y)}`,
      };
    }

    if (event.action === 'scroll') {
      if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) {
        return { ok: false, reason: 'invalid-scroll', detail: 'scroll deltas must be finite' };
      }
    }

    return OK;
  }

  if (typeof event.key !== 'string' || event.key.length === 0) {
    return { ok: false, reason: 'invalid-key', detail: 'key must be a non-empty string' };
  }

  // A single event should describe one keystroke; anything longer is a payload
  // being smuggled through a field that gets typed verbatim.
  if (event.key.length > 32) {
    return { ok: false, reason: 'invalid-key', detail: 'key is implausibly long' };
  }

  if (isDangerousCombination(event)) {
    return {
      ok: false,
      reason: 'blocked-combination',
      detail: `refused ${event.key} with the held modifiers`,
    };
  }

  return OK;
}

/**
 * Sliding-window cap on how many events per second reach the OS.
 *
 * A remote peer can generate events far faster than a human, and each
 * injection is a synchronous OS call, so an unbounded stream is a cheap way to
 * wedge the host.
 */
export class InputRateLimiter {
  private count = 0;
  private windowStart: number;

  constructor(
    private readonly maxEventsPerSecond = 1000,
    private readonly now: () => number = Date.now
  ) {
    this.windowStart = this.now();
  }

  shouldAllow(): boolean {
    const timestamp = this.now();

    if (timestamp - this.windowStart >= 1000) {
      this.count = 0;
      this.windowStart = timestamp;
    }

    this.count += 1;
    return this.count <= this.maxEventsPerSecond;
  }

  reset(): void {
    this.count = 0;
    this.windowStart = this.now();
  }
}
