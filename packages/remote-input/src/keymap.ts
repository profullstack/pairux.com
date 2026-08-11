/**
 * What a remote keystroke means on *this* keyboard.
 *
 * A viewer sends both halves of a DOM keyboard event: `code`, the physical key
 * position, and `key`, the character that position produced on the viewer's
 * layout. Neither alone is enough.
 *
 * - `code` is layout-independent, which is what a shortcut needs: Ctrl+C has to
 *   press the physical C key whatever the host's layout calls it.
 * - `key` is layout-*dependent*, which is what text needs: a German viewer
 *   pressing the key labelled Z sends `code: 'KeyY'`, and injecting the
 *   physical Y on a US host types the wrong letter. The character they saw is
 *   the only portable truth.
 *
 * So the two are used for different jobs — see {@link resolveKey}. Getting this
 * backwards is not subtle in practice: it either breaks every shortcut or
 * breaks every accented, shifted and non-US character.
 */

import type { KeyboardInputEvent, KeyboardModifiers, Platform } from './types.js';

/**
 * DOM `code` to nut.js `Key` member name.
 *
 * Names rather than enum values so this module stays free of the nut.js import
 * — the package is consumed by an Electron main process where that import is
 * expensive, and every backend needs this table, not just nut.js.
 */
export const CODE_TO_KEY_NAME: Readonly<Record<string, string>> = {
  // Letters. DOM codes are always the US position; the enum is the same.
  KeyA: 'A',
  KeyB: 'B',
  KeyC: 'C',
  KeyD: 'D',
  KeyE: 'E',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyI: 'I',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  KeyM: 'M',
  KeyN: 'N',
  KeyO: 'O',
  KeyP: 'P',
  KeyQ: 'Q',
  KeyR: 'R',
  KeyS: 'S',
  KeyT: 'T',
  KeyU: 'U',
  KeyV: 'V',
  KeyW: 'W',
  KeyX: 'X',
  KeyY: 'Y',
  KeyZ: 'Z',

  // Number row. nut.js calls these Num0-Num9; the NumPad* names are the keypad.
  Digit0: 'Num0',
  Digit1: 'Num1',
  Digit2: 'Num2',
  Digit3: 'Num3',
  Digit4: 'Num4',
  Digit5: 'Num5',
  Digit6: 'Num6',
  Digit7: 'Num7',
  Digit8: 'Num8',
  Digit9: 'Num9',

  // Punctuation.
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Backquote: 'Grave',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',

  // Editing and navigation.
  Enter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Escape: 'Escape',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',

  // Modifiers. Left and right are distinct keys and some applications care.
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftSuper',
  MetaRight: 'RightSuper',

  // Locks and system keys.
  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'Print',
  Pause: 'Pause',
  ContextMenu: 'Menu',

  // Keypad.
  Numpad0: 'NumPad0',
  Numpad1: 'NumPad1',
  Numpad2: 'NumPad2',
  Numpad3: 'NumPad3',
  Numpad4: 'NumPad4',
  Numpad5: 'NumPad5',
  Numpad6: 'NumPad6',
  Numpad7: 'NumPad7',
  Numpad8: 'NumPad8',
  Numpad9: 'NumPad9',
  NumpadDecimal: 'Decimal',
  NumpadDivide: 'Divide',
  NumpadMultiply: 'Multiply',
  NumpadSubtract: 'Subtract',
  NumpadAdd: 'Add',
  NumpadEnter: 'Enter',
  NumpadEqual: 'NumPadEqual',

  // Function keys.
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  F13: 'F13',
  F14: 'F14',
  F15: 'F15',
  F16: 'F16',
  F17: 'F17',
  F18: 'F18',
  F19: 'F19',
  F20: 'F20',
  F21: 'F21',
  F22: 'F22',
  F23: 'F23',
  F24: 'F24',

  // Media keys.
  AudioVolumeMute: 'AudioMute',
  AudioVolumeDown: 'AudioVolDown',
  AudioVolumeUp: 'AudioVolUp',
  MediaPlayPause: 'AudioPlay',
  MediaStop: 'AudioStop',
  MediaTrackPrevious: 'AudioPrev',
  MediaTrackNext: 'AudioNext',
};

/**
 * Fallback for events that carry a `key` name but no usable `code`.
 *
 * Some remote peers — and this package's own stuck-key release path — describe
 * a key by name alone. Without this a release would silently do nothing, which
 * is how a held modifier survives the thing meant to clear it.
 */
export const KEY_NAME_TO_KEY_NAME: Readonly<Record<string, string>> = {
  Control: 'LeftControl',
  Shift: 'LeftShift',
  Alt: 'LeftAlt',
  Meta: 'LeftSuper',
  OS: 'LeftSuper',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'Print',
  Pause: 'Pause',
  ContextMenu: 'Menu',
  ' ': 'Space',
  Spacebar: 'Space',
};

/**
 * Segments text the way a reader counts characters, not the way UTF-16 does.
 *
 * Built once: constructing a Segmenter per keystroke would be wasteful on a
 * path that runs for every key a viewer presses.
 */
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;

/**
 * Is this DOM `key` a single character the viewer typed?
 *
 * "Single" has to mean single *to a person*. `é` composed from `e` and a
 * combining acute is two code points and one character; an emoji is one
 * character and up to half a dozen code points. Counting either UTF-16 units or
 * code points rejects both, and a rejected character is a keystroke that
 * silently does nothing on the host — which is how accented and non-Latin input
 * quietly stops working over remote control.
 *
 * Control characters are excluded: they are named keys, not text.
 */
export function isSingleCharacter(value: string): boolean {
  if (value.length === 0) return false;
  if (value < ' ') return false;
  if (value.length === 1) return true;

  if (graphemes) {
    let count = 0;
    for (const _segment of graphemes.segment(value)) {
      count += 1;
      if (count > 1) return false;
    }
    return count === 1;
  }

  // No Segmenter: code points are still far closer than UTF-16 units.
  return Array.from(value).length === 1;
}

/** nut.js `Key` names that are modifiers, keyed by the DOM code that means them. */
const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** True when this code is a modifier key in its own right. */
export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/**
 * The physical modifier key a viewer used as their shortcut key, per host.
 *
 * Both directions matter and only one of them was ever handled. A Mac viewer's
 * Cmd arrives as `MetaLeft`; injected literally on Linux that is Super, and on
 * KDE a held Super turns every click into a window-manager gesture, so the
 * guest sees a cursor that moves and a desktop that ignores them. The mirror is
 * just as bad: a Windows viewer's Ctrl arrives as `ControlLeft`, and held
 * literally on macOS every click becomes a Control-click — a context menu
 * instead of a click.
 */
const ACCEL_CODE_FOR_HOST: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // On a Mac host the shortcut key is Cmd, so a viewer's Control becomes Meta.
  darwin: { ControlLeft: 'MetaLeft', ControlRight: 'MetaRight' },
  // Everywhere else it is Control, so a viewer's Cmd becomes Control.
  other: { MetaLeft: 'ControlLeft', MetaRight: 'ControlRight' },
};

/**
 * Translate a standalone modifier keypress for this host.
 *
 * `resolveModifiers` fixes the modifiers *carried alongside* a key, so a Mac
 * viewer's Cmd+C arrives as Ctrl+C. But the Cmd press is also a key event in
 * its own right, and injected literally it holds the wrong physical modifier
 * down for as long as the viewer holds theirs.
 *
 * Only a press that acted as the accelerator is translated. A viewer who
 * deliberately reaches for their own Super key — a Linux user opening their
 * launcher — sends `meta` without `accel` and still gets Super.
 */
export function resolveKeyCode(
  code: string,
  modifiers: KeyboardModifiers,
  platform: Platform
): string {
  if (modifiers.accel !== true) return code;
  const table = ACCEL_CODE_FOR_HOST[platform === 'darwin' ? 'darwin' : 'other'];
  return table?.[code] ?? code;
}

/**
 * What to do with a key event: press a physical key, or type a character.
 *
 * `modifier` is separate from `named` because modifiers are not driven from the
 * key event at all — they are driven from the `modifiers` field, which every
 * event carries and which therefore re-states the whole truth each time. See
 * the backends' `applyModifiers`.
 */
export type ResolvedKey =
  | { kind: 'modifier'; code: string; name: string }
  | { kind: 'named'; code: string; name: string }
  | { kind: 'text'; text: string };

/**
 * Is this keystroke text the viewer is typing, or a command they are issuing?
 *
 * The distinction decides which half of the event to trust. Holding Ctrl or Cmd
 * means "the letter names a command", so the physical key is what matters and
 * the layout must not interfere. Holding only Shift means "the letter is a
 * different letter" — `@`, `É` — and the character the viewer saw is the only
 * thing that reproduces it, because the modifier is already baked into it.
 *
 * Alt is genuinely both, and which one it is can be read off the character.
 * Option+A on a Mac composes `å`, a character no unmodified key produces, so
 * typing it is right. Alt+A on Windows is a menu accelerator and still reports
 * a plain `a`, so typing it would insert a letter where the viewer meant to
 * open a menu. Non-ASCII means composed; ASCII means accelerator.
 *
 * That second case is why Shift is not re-pressed when typing text: the viewer
 * sent `@`, not Shift+2, and pressing Shift *around* an already-shifted
 * character is how a remote desktop ends up typing `"` on a UK layout.
 */
function isTextIntent(key: string, modifiers: KeyboardModifiers): boolean {
  if (modifiers.ctrl || modifiers.meta || modifiers.accel === true) return false;
  if (!isSingleCharacter(key)) return false;
  // An ASCII character with Alt held is an accelerator, not composed text.
  if (modifiers.alt && (key.codePointAt(0) ?? 0) < 128) return false;
  return true;
}

/**
 * Decide how to inject a keyboard event on this host.
 *
 * Returns null when the event describes nothing this host can press, which the
 * caller should log rather than guess at — guessing is how `MetaLeft` ended up
 * being *typed* as the literal text "MetaLeft".
 */
export function resolveKey(event: KeyboardInputEvent, platform: Platform): ResolvedKey | null {
  const code = resolveKeyCode(event.code, event.modifiers, platform);

  if (isModifierCode(code)) {
    const name = CODE_TO_KEY_NAME[code];
    if (name !== undefined) return { kind: 'modifier', code, name };
  }

  // Text first for ordinary typing, so the viewer's layout wins over the
  // host's. Shortcuts skip this and fall through to the physical key.
  if (isTextIntent(event.key, event.modifiers)) {
    return { kind: 'text', text: event.key };
  }

  const named = CODE_TO_KEY_NAME[code];
  if (named !== undefined) return { kind: 'named', code, name: named };

  const byName = KEY_NAME_TO_KEY_NAME[event.key];
  if (byName !== undefined) return { kind: 'named', code, name: byName };

  // A printable character that reached here is a shortcut whose physical key we
  // could not place — Ctrl+ç on an unusual layout, say. Typing it is closer to
  // the viewer's intent than dropping it, but the modifiers still apply.
  if (isSingleCharacter(event.key)) return { kind: 'text', text: event.key };

  return null;
}
