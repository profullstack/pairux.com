import { describe, it, expect } from 'vitest';
import { InputRateLimiter, isDangerousCombination, validateInputEvent } from './safety.js';
import type { KeyboardInputEvent, MouseMoveEvent, MouseScrollEvent } from './types.js';

const noModifiers = { ctrl: false, alt: false, shift: false, meta: false };

function key(overrides: Partial<KeyboardInputEvent> = {}): KeyboardInputEvent {
  return {
    type: 'keyboard',
    action: 'press',
    key: 'a',
    code: 'KeyA',
    modifiers: noModifiers,
    ...overrides,
  };
}

function move(x: number, y: number): MouseMoveEvent {
  return { type: 'mouse', action: 'move', x, y };
}

describe('validateInputEvent', () => {
  it('accepts normalized coordinates', () => {
    expect(validateInputEvent(move(0, 0)).ok).toBe(true);
    expect(validateInputEvent(move(1, 1)).ok).toBe(true);
    expect(validateInputEvent(move(0.5, 0.25)).ok).toBe(true);
  });

  it.each([
    ['negative x', move(-0.1, 0.5)],
    ['x past the right edge', move(1.5, 0.5)],
    ['negative y', move(0.5, -2)],
    ['NaN', move(Number.NaN, 0.5)],
    ['Infinity', move(0.5, Number.POSITIVE_INFINITY)],
  ])('rejects out-of-range coordinates: %s', (_label, event) => {
    const result = validateInputEvent(event);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-coordinates');
  });

  it('rejects non-finite scroll deltas', () => {
    const event: MouseScrollEvent = {
      type: 'mouse',
      action: 'scroll',
      deltaX: 0,
      deltaY: Number.NaN,
      x: 0.5,
      y: 0.5,
    };
    const result = validateInputEvent(event);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-scroll');
  });

  it('accepts an ordinary keystroke', () => {
    expect(validateInputEvent(key()).ok).toBe(true);
  });

  it('rejects an empty key', () => {
    const result = validateInputEvent(key({ key: '' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-key');
  });

  // The key field is typed verbatim by some backends, so a long value is a way
  // to smuggle a whole payload through one event.
  it('rejects an implausibly long key', () => {
    const result = validateInputEvent(key({ key: 'x'.repeat(64) }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-key');
  });

  it('rejects blocked combinations', () => {
    const result = validateInputEvent(
      key({ key: 'Delete', code: 'Delete', modifiers: { ...noModifiers, ctrl: true, alt: true } })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('blocked-combination');
  });
});

describe('isDangerousCombination', () => {
  it('blocks Ctrl+Alt+Delete', () => {
    expect(
      isDangerousCombination(
        key({ key: 'Delete', modifiers: { ...noModifiers, ctrl: true, alt: true } })
      )
    ).toBe(true);
  });

  it('blocks the lock-screen shortcut regardless of key case', () => {
    expect(
      isDangerousCombination(key({ key: 'l', modifiers: { ...noModifiers, meta: true } }))
    ).toBe(true);
    expect(
      isDangerousCombination(key({ key: 'L', modifiers: { ...noModifiers, meta: true } }))
    ).toBe(true);
  });

  it('still blocks when extra modifiers are held', () => {
    expect(
      isDangerousCombination(
        key({
          key: 'Delete',
          modifiers: { ctrl: true, alt: true, shift: true, meta: false },
        })
      )
    ).toBe(true);
  });

  // The bypass. A Mac viewer's Cmd+L reports `accel: true, meta: false`,
  // because the accelerator is sent portably rather than as a literal modifier.
  // Matching on the literal flags meant the lock-screen guard did not apply to
  // any Mac-to-anywhere session — a guest could lock the host out of their own
  // machine mid-session, which is precisely what the guard exists to prevent.
  it("blocks a Mac viewer's Cmd+L, sent as the accelerator", () => {
    const cmdL = key({ key: 'l', modifiers: { ...noModifiers, accel: true } });
    expect(isDangerousCombination(cmdL, 'darwin')).toBe(true);
  });

  it("blocks a PC viewer's Super+L on a Linux host", () => {
    const superL = key({ key: 'l', modifiers: { ...noModifiers, meta: true } });
    expect(isDangerousCombination(superL, 'linux')).toBe(true);
  });

  // The accelerator is Control on Linux, so Ctrl+L there is "focus the address
  // bar", not the lock screen. Resolving per host keeps ordinary shortcuts
  // working rather than blocking them everywhere to be safe.
  it("lets a Mac viewer's Cmd+L through as Ctrl+L on a Linux host", () => {
    const cmdL = key({ key: 'l', modifiers: { ...noModifiers, accel: true } });
    expect(isDangerousCombination(cmdL, 'linux')).toBe(false);
  });

  it("blocks a Mac viewer's Cmd+Alt+Escape force-quit picker", () => {
    const forceQuit = key({
      key: 'Escape',
      modifiers: { ...noModifiers, alt: true, accel: true },
    });
    expect(isDangerousCombination(forceQuit, 'darwin')).toBe(true);
  });

  it('allows the same key without the dangerous modifiers', () => {
    expect(isDangerousCombination(key({ key: 'Delete' }))).toBe(false);
    expect(isDangerousCombination(key({ key: 'l' }))).toBe(false);
    // Ctrl+Delete (delete word) is ordinary editing, not the SAS.
    expect(
      isDangerousCombination(key({ key: 'Delete', modifiers: { ...noModifiers, ctrl: true } }))
    ).toBe(false);
  });
});

describe('InputRateLimiter', () => {
  it('allows events up to the ceiling and refuses the rest', () => {
    const now = 1000;
    const limiter = new InputRateLimiter(3, () => now);

    expect(limiter.shouldAllow()).toBe(true);
    expect(limiter.shouldAllow()).toBe(true);
    expect(limiter.shouldAllow()).toBe(true);
    expect(limiter.shouldAllow()).toBe(false);
  });

  it('starts a fresh window after a second elapses', () => {
    let now = 1000;
    const limiter = new InputRateLimiter(2, () => now);

    expect(limiter.shouldAllow()).toBe(true);
    expect(limiter.shouldAllow()).toBe(true);
    expect(limiter.shouldAllow()).toBe(false);

    now += 1000;
    expect(limiter.shouldAllow()).toBe(true);
  });

  it('reset clears the current window', () => {
    const now = 1000;
    const limiter = new InputRateLimiter(1, () => now);

    expect(limiter.shouldAllow()).toBe(true);
    expect(limiter.shouldAllow()).toBe(false);

    limiter.reset();
    expect(limiter.shouldAllow()).toBe(true);
  });
});
