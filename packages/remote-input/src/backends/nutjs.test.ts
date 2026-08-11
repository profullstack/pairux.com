/**
 * The nut.js backend's keyboard path, which had no tests at all.
 *
 * That gap is why two separate fixes to cross-platform modifiers shipped
 * without working: `resolveKeyCode` was threaded into a `mapKey` that resolved
 * `key` before `code` and so never consulted it, and the stuck-key release path
 * described keys by code alone, which the same function turned into literal
 * text. Both were covered by unit tests of the pure helpers. Neither helper was
 * reachable from the backend.
 *
 * nut.js is a peer dependency and talks to the real desktop, so it is mocked —
 * but everything between the wire event and the nut.js call is real.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { KeyboardInputEvent, KeyboardModifiers } from '../types.js';

// A stand-in for nut.js's Key enum. Only the names matter: the backend looks
// members up by name, so any stable numbering exercises the same code.
const Key = {
  A: 72,
  C: 90,
  Z: 88,
  Enter: 103,
  Escape: 0,
  Right: 121,
  LeftShift: 87,
  RightShift: 98,
  LeftControl: 104,
  RightControl: 110,
  LeftAlt: 108,
  RightAlt: 113,
  LeftSuper: 105,
  RightSuper: 111,
  Num2: 30,
  NumPad5: 85,
} as const;

const Button = { LEFT: 0, MIDDLE: 1, RIGHT: 2 } as const;

const keyboard = {
  config: { autoDelayMs: 0 },
  pressKey: vi.fn().mockResolvedValue(undefined),
  releaseKey: vi.fn().mockResolvedValue(undefined),
  type: vi.fn().mockResolvedValue(undefined),
};

const mouse = {
  config: { autoDelayMs: 0, mouseSpeed: 0 },
  setPosition: vi.fn().mockResolvedValue(undefined),
  getPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  pressButton: vi.fn().mockResolvedValue(undefined),
  releaseButton: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  doubleClick: vi.fn().mockResolvedValue(undefined),
  scrollUp: vi.fn().mockResolvedValue(undefined),
  scrollDown: vi.fn().mockResolvedValue(undefined),
  scrollLeft: vi.fn().mockResolvedValue(undefined),
  scrollRight: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@nut-tree-fork/nut-js', () => ({
  Key,
  Button,
  keyboard,
  mouse,
  screen: { width: () => Promise.resolve(1920), height: () => Promise.resolve(1080) },
}));

const { NutJsInputBackend } = await import('./nutjs.js');

const none: KeyboardModifiers = { ctrl: false, alt: false, shift: false, meta: false };
const accel: KeyboardModifiers = { ...none, accel: true };

function event(partial: Partial<KeyboardInputEvent>): KeyboardInputEvent {
  return {
    type: 'keyboard',
    action: 'down',
    key: 'a',
    code: 'KeyA',
    modifiers: none,
    ...partial,
  };
}

/** Pin the host platform, since the backend resolves against process.platform. */
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const realPlatform = process.platform;

describe('NutJsInputBackend pointer mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onPlatform(realPlatform);
  });

  it('maps normalized coordinates onto the primary display by default', async () => {
    const backend = new NutJsInputBackend();
    backend.updateScreenSize(1920, 1080);

    await backend.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });

    expect(mouse.setPosition).toHaveBeenCalledWith({ x: 960, y: 540 });
  });

  // Sharing the monitor to the right used to send every click to the primary
  // display: the guest aimed at the middle of the screen they could see and the
  // pointer moved on one they could not.
  it('maps onto the shared display once capture bounds are known', async () => {
    const backend = new NutJsInputBackend();
    backend.updateScreenSize(1920, 1080);
    backend.updateCaptureBounds({ x: 1920, y: 0, width: 2560, height: 1440 });

    await backend.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });

    expect(mouse.setPosition).toHaveBeenCalledWith({ x: 3200, y: 720 });
  });

  it('reads the pointer back relative to the shared display', async () => {
    const backend = new NutJsInputBackend();
    backend.updateScreenSize(1920, 1080);
    backend.updateCaptureBounds({ x: 1920, y: 0, width: 2560, height: 1440 });
    mouse.getPosition.mockResolvedValueOnce({ x: 3200, y: 720 });

    expect(await backend.getCursorPosition()).toEqual({ x: 0.5, y: 0.5 });
  });

  it('goes back to the primary display when the bounds are cleared', async () => {
    const backend = new NutJsInputBackend();
    backend.updateScreenSize(1920, 1080);
    backend.updateCaptureBounds({ x: 1920, y: 0, width: 2560, height: 1440 });
    backend.updateCaptureBounds(null);

    await backend.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });

    expect(mouse.setPosition).toHaveBeenCalledWith({ x: 960, y: 540 });
  });
});

describe('NutJsInputBackend keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onPlatform(realPlatform);
  });

  // The bug v0.9.62 set out to fix and did not, on this backend. A Mac guest's
  // Cmd press arrived as `code: 'MetaLeft'` with `key: 'Meta'`, and the old
  // mapping matched on `key` first, so the translated code was never read and
  // Super went down on the Linux host regardless.
  it("presses Control for a Mac viewer's Cmd, not Super", async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: 'Meta', code: 'MetaLeft', modifiers: accel }));

    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl);
    expect(keyboard.pressKey).not.toHaveBeenCalledWith(Key.LeftSuper);
  });

  // The mirror case, which was never handled: a PC viewer's Ctrl held literally
  // on a Mac makes every click a Control-click, so clicking opens context menus.
  it("presses Cmd for a PC viewer's Ctrl on a macOS host", async () => {
    onPlatform('darwin');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: 'Control', code: 'ControlLeft', modifiers: accel }));

    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftSuper);
    expect(keyboard.pressKey).not.toHaveBeenCalledWith(Key.LeftControl);
  });

  it('turns a Mac viewer’s Cmd+C into Ctrl+C on Linux', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: 'c', code: 'KeyC', modifiers: accel }));

    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl);
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.C);
    // Not typed as text: a shortcut is a key press, and typing 'c' with Ctrl
    // held is at the mercy of the host's layout.
    expect(keyboard.type).not.toHaveBeenCalled();
  });

  // The release path. `releaseAll` describes a held key by code alone, and the
  // old mapping turned 'MetaLeft' into the literal string "MetaLeft" — which
  // the 'up' branch then skipped, because it only released non-string keys. So
  // the one mechanism meant to clear a stuck modifier silently did nothing.
  it('actually releases a modifier described only by its code', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: 'Meta', code: 'MetaLeft', modifiers: accel }));
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl);

    // Exactly the shape RemoteInputInjector.releaseAll sends.
    await backend.inject(
      event({ action: 'up', key: 'MetaLeft', code: 'MetaLeft', modifiers: none })
    );

    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl);
  });

  it('never types a key name as literal text', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: 'MetaLeft', code: 'MetaLeft', modifiers: none }));
    await backend.inject(event({ key: 'ArrowRight', code: 'ArrowRight', modifiers: none }));

    for (const [typed] of keyboard.type.mock.calls) {
      expect(typed).not.toMatch(/^(Meta|Control|Shift|Alt|Arrow)/);
    }
  });

  // A held modifier used to be re-pressed before every key and released after
  // every key-up, so holding Shift through a word dropped it mid-word.
  it('holds a modifier across a chord instead of re-pressing it', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();
    const shift: KeyboardModifiers = { ...none, shift: true };

    await backend.inject(event({ key: 'Shift', code: 'ShiftLeft', modifiers: shift }));
    await backend.inject(event({ key: 'ArrowRight', code: 'ArrowRight', modifiers: shift }));
    await backend.inject(
      event({ action: 'up', key: 'ArrowRight', code: 'ArrowRight', modifiers: shift })
    );

    const shiftPresses = keyboard.pressKey.mock.calls.filter(([k]) => k === Key.LeftShift);
    const shiftReleases = keyboard.releaseKey.mock.calls.filter(([k]) => k === Key.LeftShift);
    expect(shiftPresses).toHaveLength(1);
    // Still held: the viewer has not let go, so neither has the host.
    expect(shiftReleases).toHaveLength(0);
  });

  // Every event restates the whole modifier set, so a release that never
  // arrives is corrected by the next keystroke rather than sticking forever.
  it('releases a modifier whose key-up was lost', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: 'Meta', code: 'MetaLeft', modifiers: accel }));
    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl);

    // No key-up for Meta. Just an ordinary keystroke that reports it is gone.
    await backend.inject(event({ key: 'a', code: 'KeyA', modifiers: none }));

    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl);
  });

  it('types a character rather than pressing the US key at that position', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    // A German viewer's Z sits where a US keyboard has Y.
    await backend.inject(event({ key: 'z', code: 'KeyY', modifiers: none }));

    expect(keyboard.type).toHaveBeenCalledWith('z');
    expect(keyboard.pressKey).not.toHaveBeenCalledWith(Key.Z);
  });

  // Shift is already baked into '@'. Holding it while typing applies the shift
  // twice and lands on a different character on most non-US layouts.
  it('does not hold Shift while typing an already-shifted character', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ key: '@', code: 'Digit2', modifiers: { ...none, shift: true } }));

    expect(keyboard.type).toHaveBeenCalledWith('@');
    expect(keyboard.pressKey).not.toHaveBeenCalledWith(Key.LeftShift);
  });

  it('leaves nothing held after a one-shot press', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(event({ action: 'press', key: 'c', code: 'KeyC', modifiers: accel }));

    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.C);
    expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl);
  });

  it('forgets its held modifiers after an emergency stop', async () => {
    onPlatform('linux');
    const backend = new NutJsInputBackend();

    await backend.inject(
      event({ key: 'Shift', code: 'ShiftLeft', modifiers: { ...none, shift: true } })
    );
    await backend.emergencyStop();
    keyboard.pressKey.mockClear();

    // Shift must be pressed again: the stop released it behind the tracker's
    // back, and assuming it is still down would leave the chord unshifted.
    await backend.inject(
      event({ key: 'ArrowRight', code: 'ArrowRight', modifiers: { ...none, shift: true } })
    );

    expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftShift);
  });
});
