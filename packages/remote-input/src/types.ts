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
  /**
   * DOM `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages.
   *
   * Without it a trackpad and a mouse wheel are indistinguishable, and the
   * trackpad's stream of 3px deltas each get treated as a whole wheel notch —
   * which is why remote scrolling was unusably fast. Optional so an older
   * viewer that omits it is read as pixels, the overwhelmingly common case.
   */
  deltaMode?: number;
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
  /**
   * The viewer held their platform's shortcut modifier: Cmd on macOS, Ctrl
   * everywhere else. Backends map it to whichever modifier means "shortcut" on
   * *this* host, so a shortcut survives crossing operating systems — a Mac
   * viewer's Cmd+C has to become Ctrl+C on a Linux host, not Super+C.
   *
   * Optional: an older viewer that omits it keeps the literal pass-through.
   */
  accel?: boolean;
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
 * The region of the host's desktop the viewer's 0-1 coordinates describe.
 *
 * Normalized coordinates are meaningless without knowing what they are
 * normalized *against*. The implicit answer used to be "the primary display",
 * which silently breaks the moment a host shares their second monitor: the
 * viewer aims at the middle of the screen they can see and the click lands in
 * the middle of a screen they cannot.
 *
 * `x` and `y` place the rectangle in the desktop's global coordinate space —
 * the same space the OS uses to lay monitors out side by side — so a display
 * to the right of the primary one starts at its width, not at zero.
 */
export interface CaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
  /**
   * Which rectangle of the desktop the viewer is actually looking at.
   *
   * Optional; a backend that omits it maps onto the whole primary screen, which
   * is only correct when that is what is being shared.
   */
  updateCaptureBounds?: (bounds: CaptureBounds | null) => void;
  inject: (event: InputEvent) => Promise<void>;
  emergencyStop: () => Promise<void>;
  /**
   * Where the local pointer is right now, normalized 0-1, or null when the
   * platform will not say.
   *
   * Needed to put the local user's pointer back after a remote click borrows
   * it. X11 and macOS can answer; Wayland gives clients no way to query the
   * pointer, so those backends omit this and lose exact restoration.
   */
  getCursorPosition?: () => Promise<{ x: number; y: number } | null>;
  /**
   * Release OS resources on shutdown.
   *
   * The Wayland backend installs a helper into the compositor, which would
   * otherwise keep pushing to a DBus name that no longer exists once the app
   * has quit.
   */
  dispose?: () => Promise<void>;
  /**
   * Begin any optional machinery needed to report the cursor position.
   *
   * Separate from init() because on Wayland this installs a hook into the
   * compositor's input path, which should only be present while a remote
   * participant actually holds control.
   */
  startCursorReporting?: () => Promise<void>;
}

export interface InputStats {
  received: number;
  injected: number;
  rejected: number;
  errors: number;
  /**
   * Pointer moves dropped because a newer position had already replaced them.
   *
   * Expected to be large during normal use and is not a fault: a viewer streams
   * movement far faster than any host can inject it, and only the newest
   * position means anything. Worth watching all the same — if this is zero on a
   * host that feels laggy, the backlog is somewhere else.
   */
  coalesced: number;
}

export interface InputDiagnostics {
  enabled: boolean;
  backend: string;
  backendSupported: boolean;
  reason?: string;
  details?: Record<string, unknown>;
  stats: InputStats;
  /**
   * How many buttons and keys the injector believes are held right now.
   *
   * Worth surfacing because a stuck hold is not a quiet failure: a held button
   * makes every remote move inject as a drag, so the guest's pointer drives
   * the host's and the host loses their machine. Non-zero here while nobody is
   * pressing anything is that state, and is otherwise invisible.
   */
  heldButtons: number;
  heldKeys: number;
}
