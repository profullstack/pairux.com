/**
 * Input event and backend contracts.
 *
 * These types are intentionally self-contained so the package can be consumed
 * standalone. Coordinates are normalized (0-1) rather than pixels so a viewer
 * never needs to know the host's resolution, DPI, or monitor layout.
 */

export type MouseButton = 'left' | 'right' | 'middle';

export interface MouseMoveEvent {
  type: 'mouse';
  action: 'move';
  /** 0-1, relative to the shared surface. */
  x: number;
  /** 0-1, relative to the shared surface. */
  y: number;
}

export interface MouseButtonEvent {
  type: 'mouse';
  action: 'down' | 'up' | 'click' | 'dblclick';
  button: MouseButton;
  x: number;
  y: number;
}

export interface MouseScrollEvent {
  type: 'mouse';
  action: 'scroll';
  deltaX: number;
  deltaY: number;
  x: number;
  y: number;
}

export type MouseInputEvent = MouseMoveEvent | MouseButtonEvent | MouseScrollEvent;

export interface KeyboardModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Cmd on macOS, Win on Windows, Super on Linux. */
  meta: boolean;
}

export interface KeyboardInputEvent {
  type: 'keyboard';
  action: 'down' | 'up' | 'press';
  /** Printable value, e.g. 'a', 'Enter', 'Escape'. */
  key: string;
  /** Physical code, e.g. 'KeyA', 'Enter', 'Escape'. */
  code: string;
  modifiers: KeyboardModifiers;
}

export type InputEvent = MouseInputEvent | KeyboardInputEvent;

export type Platform = NodeJS.Platform;

export type DisplayServer = 'x11' | 'wayland' | 'windows' | 'macos' | 'unknown';

export interface InputBackendInitResult {
  screenWidth?: number;
  screenHeight?: number;
}

/**
 * An OS-specific way to move the pointer and press keys.
 *
 * A backend reports `supported: false` with a human-readable `reason` rather
 * than throwing, so a host can explain to the user exactly why control is
 * unavailable (missing ydotool daemon, unimplemented portal, etc.).
 */
export interface InputBackend {
  readonly name: string;
  readonly supported: boolean;
  readonly reason?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
  init: () => Promise<InputBackendInitResult | undefined>;
  updateScreenSize: (width: number, height: number) => void;
  inject: (event: InputEvent) => Promise<void>;
  emergencyStop: () => Promise<void>;
}

export interface InputStats {
  received: number;
  injected: number;
  rejected: number;
  errors: number;
}

export interface InputDiagnostics {
  enabled: boolean;
  backend: string;
  backendSupported: boolean;
  reason?: string;
  details?: Record<string, unknown>;
  stats: InputStats;
}
