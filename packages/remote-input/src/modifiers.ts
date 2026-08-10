/**
 * Which modifiers a backend should actually hold down.
 *
 * The wire carries the viewer's modifiers as the viewer's OS reported them,
 * which is not portable: "the shortcut key" is Cmd on macOS and Ctrl elsewhere,
 * and injecting the literal one on a different OS produces a keystroke nobody
 * asked for. Cmd+C arriving on Linux as Super+C copies nothing; Ctrl+C arriving
 * on macOS as Control+C copies nothing either.
 *
 * So `accel` says "the shortcut modifier was held" and this decides what that
 * means locally, leaving `ctrl`/`meta` for the cases that really do mean
 * Control (macOS Control+click) or Super (Linux window manager bindings).
 */

import type { KeyboardModifiers, Platform } from './types.js';

/** Modifiers resolved for a specific host, with no platform ambiguity left. */
export interface ResolvedModifiers {
  control: boolean;
  alt: boolean;
  shift: boolean;
  /** Cmd on macOS, Super/Win elsewhere. */
  meta: boolean;
}

export function resolveModifiers(
  modifiers: KeyboardModifiers,
  platform: Platform
): ResolvedModifiers {
  const hostUsesMetaForShortcuts = platform === 'darwin';
  const accel = modifiers.accel === true;

  return {
    // On a non-macOS host the shortcut modifier *is* Control, so fold accel in.
    control: modifiers.ctrl || (accel && !hostUsesMetaForShortcuts),
    alt: modifiers.alt,
    shift: modifiers.shift,
    // On macOS the shortcut modifier is Cmd, which is the meta key.
    meta: modifiers.meta || (accel && hostUsesMetaForShortcuts),
  };
}

/** Physical modifier keys that mean "shortcut key" on a Mac and Super elsewhere. */
const ACCEL_KEY_CODES: Record<string, string> = {
  MetaLeft: 'ControlLeft',
  MetaRight: 'ControlRight',
};

/**
 * Translate a standalone modifier keypress for this host.
 *
 * `resolveModifiers` fixes the modifiers *carried alongside* a key, so a Mac
 * guest's Cmd+C arrives as Ctrl+C. But the Cmd press is also a key event in its
 * own right, with `code: 'MetaLeft'`, and that was injected literally — so
 * every time a Mac guest touched Cmd, the Linux host had Super held down.
 *
 * That is not a cosmetic mismatch. On KDE, Super+click is a window-manager
 * gesture (move/resize), so clicks stop reaching the application underneath
 * entirely, and Super on its own opens the launcher. The guest sees a cursor
 * that moves and a desktop that ignores every click.
 *
 * So the physical key gets the same treatment as the modifier field: pressed as
 * an accelerator, it becomes whatever the accelerator is here. A Super press
 * that was *not* the accelerator (a non-Mac guest reaching for their Super key)
 * is still passed through untouched.
 */
export function resolveKeyCode(
  code: string,
  modifiers: KeyboardModifiers,
  platform: Platform
): string {
  if (modifiers.accel !== true) return code;
  // On a Mac host the accelerator *is* Cmd, so the code is already right.
  if (platform === 'darwin') return code;
  return ACCEL_KEY_CODES[code] ?? code;
}

// The viewer half of this — turning a DOM event into wire modifiers — lives in
// @pairux/shared-types as `modifiersFromDomEvent`, because this package is
// deliberately standalone and Node-only while the viewers run in a browser.
// The two must stay in step: `accel` set there is what `resolveModifiers` reads.
