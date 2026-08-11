/**
 * Input event types for remote control
 */

// Mouse move event
export interface MouseMoveEvent {
  type: 'mouse';
  action: 'move';
  x: number; // 0-1 relative to screen
  y: number; // 0-1 relative to screen
}

// Mouse button type
export type MouseButton = 'left' | 'right' | 'middle';

// Mouse button event
export interface MouseButtonEvent {
  type: 'mouse';
  action: 'down' | 'up' | 'click' | 'dblclick';
  button: MouseButton;
  x: number;
  y: number;
}

// Mouse scroll event
export interface MouseScrollEvent {
  type: 'mouse';
  action: 'scroll';
  /** DOM WheelEvent convention: positive scrolls right. */
  deltaX: number;
  /**
   * DOM WheelEvent convention: **positive scrolls down**.
   *
   * Spelled out because both host backends had it backwards, which made every
   * remote scroll go the wrong way on every platform.
   */
  deltaY: number;
  /**
   * DOM `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages.
   *
   * Without it a trackpad and a mouse wheel look identical on the wire, and the
   * trackpad's stream of 2-4px deltas each became a whole wheel notch on the
   * host — a gentle two-finger drag arriving as thirty hard clicks. Optional so
   * an older viewer that omits it is read as pixels.
   */
  deltaMode?: number;
  x: number;
  y: number;
}

// All mouse events union
export type MouseEvent = MouseMoveEvent | MouseButtonEvent | MouseScrollEvent;

// Keyboard modifiers
export interface KeyboardModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean; // Cmd on macOS, Win on Windows
  /**
   * The viewer held their platform's shortcut modifier: Cmd on macOS, Ctrl
   * everywhere else.
   *
   * Sent instead of the literal modifier, because the literal one does not
   * survive crossing operating systems. A Mac viewer pressing Cmd+C reports
   * `meta`, which on a Linux host is Super — and Super+C copies nothing.
   * A Linux viewer pressing Ctrl+C reports `ctrl`, which on a macOS host is
   * Control, and Control+C is not copy either. So copy/paste, save, quit and
   * every other shortcut broke in both directions.
   *
   * The host maps this to whichever modifier means "shortcut" locally. `ctrl`
   * and `meta` stay literal for the cases that genuinely mean Control or Super
   * (macOS Control+click, Linux Super for the window manager).
   *
   * Optional for compatibility: an older viewer that omits it still gets the
   * previous literal pass-through behaviour.
   */
  accel?: boolean;
}

/**
 * Turn a DOM keyboard event's modifier flags into portable wire modifiers.
 *
 * Viewers must use this rather than copying `ctrlKey`/`metaKey` straight across.
 * "The shortcut key" is Cmd on macOS and Ctrl everywhere else, so the literal
 * flag does not survive a change of operating system: Cmd+C sent as `meta`
 * arrives on Linux as Super+C, and Ctrl+C sent as `ctrl` arrives on macOS as
 * Control+C. Neither copies anything.
 *
 * Whichever key acted as the accelerator is reported as `accel` alone, so the
 * host presses one shortcut modifier instead of its own plus the viewer's. The
 * host side of this is `resolveModifiers` in @profullstack/remote-input.
 */
export function modifiersFromDomEvent(
  event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
  platform: 'darwin' | 'other'
): KeyboardModifiers {
  const isMac = platform === 'darwin';

  return {
    // macOS Control is a real modifier of its own (Control+click), so it stays
    // literal there. Off macOS, Ctrl is the accelerator and nothing else.
    ctrl: isMac ? event.ctrlKey : false,
    alt: event.altKey,
    shift: event.shiftKey,
    // Super/Win is literal off macOS; on macOS Cmd is the accelerator.
    meta: isMac ? false : event.metaKey,
    accel: isMac ? event.metaKey : event.ctrlKey,
  };
}

const POINTER_MOUSE_DEDUP_MS = 100;

export function isLocalControlTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object' || !('closest' in target)) return false;
  const closest = target.closest;
  return (
    typeof closest === 'function' && closest.call(target, '[data-pairux-local-control]') !== null
  );
}

export function shouldIgnoreFollowUpMouse(
  lastPointerAt: number,
  now: number,
  fromPointer: boolean
): boolean {
  return !fromPointer && now - lastPointerAt < POINTER_MOUSE_DEDUP_MS;
}

// Keyboard event
export interface KeyboardEvent {
  type: 'keyboard';
  action: 'down' | 'up' | 'press';
  key: string; // e.g., 'a', 'Enter', 'Escape'
  code: string; // e.g., 'KeyA', 'Enter', 'Escape'
  modifiers: KeyboardModifiers;
}

// Union type for all input events
export type InputEvent = MouseEvent | KeyboardEvent;

// Input message wrapper (sent over data channel)
export interface InputMessage {
  type: 'input';
  timestamp: number;
  sequence: number; // For ordering
  event: InputEvent;
}

// Control state (matches database type but used in UI)
export type ControlStateUI = 'view-only' | 'requested' | 'granted';

// Control transition triggers
export type ControlTransitionTrigger =
  | 'REQUEST_CONTROL'
  | 'DENY_REQUEST'
  | 'REQUEST_TIMEOUT'
  | 'APPROVE_REQUEST'
  | 'REVOKE_CONTROL'
  | 'RELEASE_CONTROL'
  | 'EMERGENCY_REVOKE'
  | 'VIEWER_DISCONNECT';

// Screen capture source
export interface CaptureSource {
  id: string;
  name: string;
  thumbnail?: string;
  type: 'screen' | 'window';
  displayId?: string;
}

// Capture settings
export interface CaptureSettings {
  resolution: 'native' | '1080p' | '720p';
  frameRate: 15 | 30 | 60;
  includeCursor: boolean;
  includeAudio: boolean;
}

// Quality preset
export interface QualityPreset {
  name: 'low' | 'medium' | 'high' | 'ultra';
  bitrate: number;
  resolution: number; // Scale factor (1.0 = native)
  frameRate: number;
}

// Default quality presets
export const QUALITY_PRESETS: Record<QualityPreset['name'], QualityPreset> = {
  low: { name: 'low', bitrate: 1_000_000, resolution: 0.5, frameRate: 15 },
  medium: { name: 'medium', bitrate: 2_500_000, resolution: 0.75, frameRate: 30 },
  high: { name: 'high', bitrate: 4_000_000, resolution: 1.0, frameRate: 30 },
  ultra: { name: 'ultra', bitrate: 8_000_000, resolution: 1.0, frameRate: 60 },
};
