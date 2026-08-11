import { describe, expect, it } from 'vitest';
import { resolveKey, resolveKeyCode, isModifierCode, CODE_TO_KEY_NAME } from './keymap.js';
import type { KeyboardInputEvent, KeyboardModifiers } from './types.js';

const none: KeyboardModifiers = { ctrl: false, alt: false, shift: false, meta: false };
const accel: KeyboardModifiers = { ...none, accel: true };

function key(partial: Partial<KeyboardInputEvent>): KeyboardInputEvent {
  return {
    type: 'keyboard',
    action: 'down',
    key: 'a',
    code: 'KeyA',
    modifiers: none,
    ...partial,
  };
}

// The modifier keypress itself, not just the modifiers carried alongside it.
// A Mac guest's Cmd press arriving as Super turned every click on a KDE host
// into a window-manager gesture: the cursor moved and the desktop ignored it.
describe('resolveKeyCode', () => {
  it("maps a Mac guest's Cmd press to Control on a Linux host", () => {
    expect(resolveKeyCode('MetaLeft', accel, 'linux')).toBe('ControlLeft');
    expect(resolveKeyCode('MetaRight', accel, 'linux')).toBe('ControlRight');
  });

  it('maps it to Control on Windows too', () => {
    expect(resolveKeyCode('MetaLeft', accel, 'win32')).toBe('ControlLeft');
  });

  // The mirror case, which went unhandled while only the Cmd->Ctrl direction
  // was fixed. A PC guest's Ctrl held literally on macOS makes every click a
  // Control-click, so clicking opens context menus instead of clicking.
  it("maps a PC guest's Ctrl press to Cmd on a macOS host", () => {
    expect(resolveKeyCode('ControlLeft', accel, 'darwin')).toBe('MetaLeft');
    expect(resolveKeyCode('ControlRight', accel, 'darwin')).toBe('MetaRight');
  });

  it('leaves the accelerator alone when it is already the right key', () => {
    expect(resolveKeyCode('MetaLeft', accel, 'darwin')).toBe('MetaLeft');
    expect(resolveKeyCode('ControlLeft', accel, 'linux')).toBe('ControlLeft');
  });

  // A non-Mac guest reaching for their actual Super key still gets Super.
  it('passes through a Super press that was not the accelerator', () => {
    expect(resolveKeyCode('MetaLeft', { ...none, meta: true }, 'linux')).toBe('MetaLeft');
  });

  it('leaves ordinary keys untouched', () => {
    expect(resolveKeyCode('KeyC', accel, 'linux')).toBe('KeyC');
    expect(resolveKeyCode('Enter', accel, 'linux')).toBe('Enter');
  });
});

describe('resolveKey', () => {
  // Modifiers are never pressed from the key event; the modifier snapshot on
  // every event is the single source of truth, which is what lets a lost
  // release heal itself on the next keystroke.
  it('classifies a modifier press as a modifier, translated for this host', () => {
    expect(resolveKey(key({ key: 'Meta', code: 'MetaLeft', modifiers: accel }), 'linux')).toEqual({
      kind: 'modifier',
      code: 'ControlLeft',
      name: 'LeftControl',
    });
  });

  it('resolves a shortcut to the physical key, ignoring the layout', () => {
    expect(resolveKey(key({ key: 'c', code: 'KeyC', modifiers: accel }), 'linux')).toEqual({
      kind: 'named',
      code: 'KeyC',
      name: 'C',
    });
  });

  // A German viewer presses the key labelled Z; the browser reports the US
  // position `KeyY`. Injecting the physical key would type 'y'.
  it('types the character the viewer saw rather than the US key position', () => {
    expect(resolveKey(key({ key: 'z', code: 'KeyY' }), 'linux')).toEqual({
      kind: 'text',
      text: 'z',
    });
  });

  // Shift is already baked into '@'. Pressing Shift around it types '"' on a
  // UK layout, which is exactly the class of bug this split avoids.
  it('treats a shifted character as text, not as Shift plus a key', () => {
    const resolved = resolveKey(
      key({ key: '@', code: 'Digit2', modifiers: { ...none, shift: true } }),
      'linux'
    );
    expect(resolved).toEqual({ kind: 'text', text: '@' });
  });

  // Alt is both things at once, and the character says which. Alt+A on Windows
  // opens a menu and still reports a plain 'a', so typing it would insert a
  // letter where the viewer meant to reach the menu bar.
  it('treats Alt plus an ASCII letter as an accelerator', () => {
    expect(
      resolveKey(key({ key: 'a', code: 'KeyA', modifiers: { ...none, alt: true } }), 'win32')
    ).toEqual({ kind: 'named', code: 'KeyA', name: 'A' });
  });

  // Option+A on a Mac composes 'å' — a character no unmodified key produces, so
  // the only way to reproduce it on the host is to type it.
  it('treats Alt plus a composed character as text', () => {
    expect(
      resolveKey(key({ key: 'å', code: 'KeyA', modifiers: { ...none, alt: true } }), 'linux')
    ).toEqual({ kind: 'text', text: 'å' });
  });

  it('keeps Shift as a real modifier when the key is not a character', () => {
    expect(
      resolveKey(
        key({ key: 'ArrowRight', code: 'ArrowRight', modifiers: { ...none, shift: true } }),
        'linux'
      )
    ).toEqual({ kind: 'named', code: 'ArrowRight', name: 'Right' });
  });

  // The stuck-key release path describes a key by code alone. It used to fall
  // through to "type the literal string MetaLeft", so a held modifier survived
  // the very mechanism meant to clear it.
  it('resolves a key described only by its code, as the release path does', () => {
    expect(resolveKey(key({ key: 'MetaLeft', code: 'MetaLeft' }), 'linux')).toEqual({
      kind: 'modifier',
      code: 'MetaLeft',
      name: 'LeftSuper',
    });
  });

  it('resolves a key described only by its DOM name', () => {
    expect(resolveKey(key({ key: 'Enter', code: '' }), 'linux')).toEqual({
      kind: 'named',
      code: '',
      name: 'Enter',
    });
  });

  it('returns null rather than guessing at an unknown key', () => {
    expect(resolveKey(key({ key: 'Unidentified', code: 'Lang5' }), 'linux')).toBeNull();
  });

  it('treats emoji as a single character', () => {
    expect(resolveKey(key({ key: '😀', code: '' }), 'linux')).toEqual({
      kind: 'text',
      text: '😀',
    });
  });
});

describe('isModifierCode', () => {
  it('knows both sides of every modifier', () => {
    for (const code of [
      'ShiftLeft',
      'ShiftRight',
      'ControlLeft',
      'ControlRight',
      'AltLeft',
      'AltRight',
      'MetaLeft',
      'MetaRight',
    ]) {
      expect(isModifierCode(code)).toBe(true);
      expect(CODE_TO_KEY_NAME[code]).toBeDefined();
    }
  });

  it('does not mistake an ordinary key for one', () => {
    expect(isModifierCode('KeyA')).toBe(false);
    expect(isModifierCode('CapsLock')).toBe(false);
  });
});
