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

// The viewer half of this — turning a DOM event into wire modifiers — lives in
// @pairux/shared-types as `modifiersFromDomEvent`, because this package is
// deliberately standalone and Node-only while the viewers run in a browser.
// The two must stay in step: `accel` set there is what `resolveModifiers` reads.
