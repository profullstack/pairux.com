import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { KWinCursorProvider } from '../wayland/kwinCursorProvider.js';
import { detectWaylandScreenSize, type ScreenSize } from '../wayland/screenSize.js';
import { resolveModifiers } from '../modifiers.js';
import { isInputDebugEnabled } from '../debug.js';
import type {
  InputEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  MouseScrollEvent,
  KeyboardInputEvent as KbEvent,
  MouseButton,
  InputBackend,
  InputBackendInitResult,
} from '../types.js';

type ExecRunner = (command: string, args: string[]) => Promise<void>;
type DaemonStarter = () => Promise<{ attempted: boolean; method?: string; error?: string }>;
type AvailabilityProbe = () => YdotoolAvailability;
type SleepFn = (ms: number) => Promise<void>;

interface YdotoolAvailability {
  hasBinary: boolean;
  binaryPath?: string | null;
  hasSocket: boolean;
  socketPath: string | null;
}

interface YdotoolBackendDeps {
  startDaemon?: DaemonStarter;
  probeAvailability?: AvailabilityProbe;
  sleep?: SleepFn;
  diagnoseFailure?: FailureDiagnoser;
  /** Injectable so tests never shell out to real compositor tools. */
  detectScreenSize?: ScreenSizeDetector;
}

type ScreenSizeDetector = () => Promise<ScreenSize | null>;

type FailureDiagnoser = () => Promise<string | null>;

/**
 * Work out why ydotoold produced no socket even though starting it reported
 * success. The dominant real-world cause: the unit starts and immediately dies
 * because the user has no write access to /dev/uinput.
 */
async function defaultDiagnoseDaemonFailure(): Promise<string | null> {
  try {
    const fs = await import('fs');
    await fs.promises.access('/dev/uinput', fs.constants.W_OK);
    return null;
  } catch {
    return (
      'ydotoold cannot start: no write access to /dev/uinput. ' +
      'Re-run the PairUX installer to set up the udev rule and input group ' +
      '(then log out and back in), or run `sudo ydotoold` once to enable remote control now.'
    );
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error('Unknown ydotool execution error');
}

function defaultExecRunner(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    import('child_process')
      .then(({ execFile }) => {
        execFile(command, args, { timeout: 2000 }, (error) => {
          if (error) reject(toError(error));
          else resolve();
        });
      })
      .catch((error: unknown) => {
        reject(toError(error));
      });
  });
}

function execFileAsync(command: string, args: string[], timeout = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    import('child_process')
      .then(({ execFile }) => {
        execFile(command, args, { timeout }, (error) => {
          if (error) reject(toError(error));
          else resolve();
        });
      })
      .catch((error: unknown) => {
        reject(toError(error));
      });
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canExecBinary(command: string): boolean {
  try {
    execFileSync(command, ['--help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findYdotoolBinary(): string | null {
  const candidates = [
    process.env.YDOTOOL_BIN,
    'ydotool',
    '/usr/bin/ydotool',
    '/usr/local/bin/ydotool',
    '/bin/ydotool',
  ].filter((value): value is string => Boolean(value));

  return candidates.find((command) => canExecBinary(command)) ?? null;
}

function findYdotoolSocket(): string | null {
  const candidates = [
    process.env.YDOTOOL_SOCKET,
    '/run/ydotoold/socket',
    process.env.XDG_RUNTIME_DIR ? `${process.env.XDG_RUNTIME_DIR}/.ydotool_socket` : undefined,
    '/tmp/.ydotool_socket',
  ].filter((value): value is string => Boolean(value));

  return candidates.find((path) => existsSync(path)) ?? null;
}

function getYdotoolAvailability(): YdotoolAvailability {
  const binaryPath = findYdotoolBinary();
  const socketPath = findYdotoolSocket();
  return {
    hasBinary: Boolean(binaryPath),
    binaryPath,
    hasSocket: Boolean(socketPath),
    socketPath,
  };
}

async function defaultStartYdotoolDaemon(): Promise<{
  attempted: boolean;
  method?: string;
  error?: string;
}> {
  try {
    await execFileAsync('systemctl', ['--user', 'start', 'ydotool'], 2000);
    return { attempted: true, method: 'systemctl --user start ydotool' };
  } catch (systemctlUserError) {
    try {
      const { spawn } = await import('child_process');
      const child = spawn('ydotoold', [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { attempted: true, method: 'ydotoold (detached)' };
    } catch (spawnError) {
      const errorMessage =
        spawnError instanceof Error
          ? spawnError.message
          : systemctlUserError instanceof Error
            ? systemctlUserError.message
            : String(systemctlUserError);
      return {
        attempted: true,
        method: 'systemctl --user start ydotool / ydotoold',
        error: errorMessage,
      };
    }
  }
}

function buttonBase(button: MouseButton): number {
  switch (button) {
    case 'left':
      return 0x00;
    case 'right':
      return 0x01;
    case 'middle':
      return 0x02;
    default:
      return 0x00;
  }
}

function clickCode(action: MouseButtonEvent['action'], button: MouseButton): string[] {
  const base = buttonBase(button);
  switch (action) {
    case 'down':
      return [String(0x40 | base)];
    case 'up':
      return [String(0x80 | base)];
    case 'dblclick':
      return ['--repeat', '2', String(0xc0 | base)];
    case 'click':
    default:
      return [String(0xc0 | base)];
  }
}

function scrollRepeat(delta: number): number {
  return Math.abs(Math.round(delta / 100)) || 1;
}

function scrollClickCode(base: number, repeat: number): string[] {
  return repeat > 1 ? ['--repeat', String(repeat), String(0xc0 | base)] : [String(0xc0 | base)];
}

const KEYCODES = {
  Escape: 1,
  Digit1: 2,
  Digit2: 3,
  Digit3: 4,
  Digit4: 5,
  Digit5: 6,
  Digit6: 7,
  Digit7: 8,
  Digit8: 9,
  Digit9: 10,
  Digit0: 11,
  Minus: 12,
  Equal: 13,
  Backspace: 14,
  Tab: 15,
  KeyQ: 16,
  KeyW: 17,
  KeyE: 18,
  KeyR: 19,
  KeyT: 20,
  KeyY: 21,
  KeyU: 22,
  KeyI: 23,
  KeyO: 24,
  KeyP: 25,
  BracketLeft: 26,
  BracketRight: 27,
  Enter: 28,
  ControlLeft: 29,
  KeyA: 30,
  KeyS: 31,
  KeyD: 32,
  KeyF: 33,
  KeyG: 34,
  KeyH: 35,
  KeyJ: 36,
  KeyK: 37,
  KeyL: 38,
  Semicolon: 39,
  Quote: 40,
  Backquote: 41,
  ShiftLeft: 42,
  Backslash: 43,
  KeyZ: 44,
  KeyX: 45,
  KeyC: 46,
  KeyV: 47,
  KeyB: 48,
  KeyN: 49,
  KeyM: 50,
  Comma: 51,
  Period: 52,
  Slash: 53,
  ShiftRight: 54,
  AltLeft: 56,
  Space: 57,
  CapsLock: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  NumLock: 69,
  ScrollLock: 70,
  F11: 87,
  F12: 88,
  Insert: 110,
  Delete: 111,
  MetaLeft: 125,
  MetaRight: 126,
  Home: 102,
  ArrowUp: 103,
  PageUp: 104,
  ArrowLeft: 105,
  ArrowRight: 106,
  End: 107,
  ArrowDown: 108,
  PageDown: 109,
  Pause: 119,
} satisfies Record<string, number>;

function keyCodeFromEvent(event: KbEvent): number | null {
  // event.code is remote input, so it is not necessarily a known key name.
  const direct = (KEYCODES as Record<string, number | undefined>)[event.code];
  if (direct !== undefined) return direct;

  const aliases: Record<string, number> = {
    ' ': KEYCODES.Space,
    Space: KEYCODES.Space,
    Control: KEYCODES.ControlLeft,
    Shift: KEYCODES.ShiftLeft,
    Alt: KEYCODES.AltLeft,
    Meta: KEYCODES.MetaLeft,
    ArrowUp: KEYCODES.ArrowUp,
    ArrowDown: KEYCODES.ArrowDown,
    ArrowLeft: KEYCODES.ArrowLeft,
    ArrowRight: KEYCODES.ArrowRight,
  };

  return aliases[event.key] ?? null;
}

function modifierKeycodes(modifiers: KbEvent['modifiers']): number[] {
  // This host is Linux, so the shortcut modifier is Control: a Mac viewer's
  // Cmd+C has to land as Ctrl+C, not as Super+C.
  const resolved = resolveModifiers(modifiers, 'linux');
  const keys: number[] = [];
  if (resolved.control) keys.push(KEYCODES.ControlLeft);
  if (resolved.alt) keys.push(KEYCODES.AltLeft);
  if (resolved.shift) keys.push(KEYCODES.ShiftLeft);
  if (resolved.meta) keys.push(KEYCODES.MetaLeft);
  return keys;
}

function keyToken(code: number, down: boolean): string {
  return `${String(code)}:${down ? '1' : '0'}`;
}

export class WaylandYdotoolInputBackend implements InputBackend {
  readonly name = 'wayland-ydotool';
  supported: boolean;
  reason: string | undefined;
  details?: Record<string, unknown>;
  private screenWidth = 1920;
  private screenHeight = 1080;
  // Wayland will not report the pointer, so ask the compositor instead. Only
  // used to hand the local pointer back after a remote click borrows it.
  private readonly cursorProvider = new KWinCursorProvider();
  private readonly run: ExecRunner;
  private readonly startDaemon: DaemonStarter;
  private readonly probeAvailability: AvailabilityProbe;
  private readonly sleep: SleepFn;
  private readonly diagnoseFailure: FailureDiagnoser;
  private availability: YdotoolAvailability;
  private ydotoolCommand = 'ydotool';
  private autoStartAttempted = false;
  private autoStartMethod: string | undefined;
  private autoStartError: string | undefined;
  private diagnosedReason: string | undefined;
  private readonly detectScreenSize: ScreenSizeDetector;

  constructor(
    run: ExecRunner = defaultExecRunner,
    availability: YdotoolAvailability = getYdotoolAvailability(),
    deps: YdotoolBackendDeps = {}
  ) {
    this.run = run;
    this.startDaemon = deps.startDaemon ?? defaultStartYdotoolDaemon;
    this.probeAvailability = deps.probeAvailability ?? getYdotoolAvailability;
    this.sleep = deps.sleep ?? defaultSleep;
    this.diagnoseFailure = deps.diagnoseFailure ?? defaultDiagnoseDaemonFailure;
    this.detectScreenSize = deps.detectScreenSize ?? detectWaylandScreenSize;
    this.availability = availability;
    this.supported = false;
    this.applyAvailability(availability);
  }

  private applyAvailability(availability: YdotoolAvailability): void {
    this.availability = availability;
    this.ydotoolCommand = availability.binaryPath ?? 'ydotool';
    this.supported = availability.hasBinary && availability.hasSocket;
    this.details = {
      hasYdotoolBinary: availability.hasBinary,
      ydotoolBinaryPath: availability.binaryPath ?? null,
      hasYdotoolSocket: availability.hasSocket,
      ydotoolSocketPath: availability.socketPath,
      autoStartAttempted: this.autoStartAttempted,
      autoStartMethod: this.autoStartMethod ?? null,
      autoStartError: this.autoStartError ?? null,
    };

    if (!availability.hasBinary) {
      this.reason = 'Wayland support requires `ydotool` to be installed.';
    } else if (!availability.hasSocket) {
      this.reason =
        this.diagnosedReason ??
        'Wayland support requires `ydotoold` to be running (no ydotool socket found).';
    } else {
      this.reason = undefined;
    }
  }

  private async attemptAutoStart(): Promise<void> {
    if (this.autoStartAttempted || !this.availability.hasBinary || this.availability.hasSocket) {
      return;
    }

    this.autoStartAttempted = true;
    const start = await this.startDaemon();
    this.autoStartMethod = start.method;
    this.autoStartError = start.error;

    // Give the daemon a window to create the socket (a systemd-managed start
    // can take a couple of seconds on a busy session).
    for (let i = 0; i < 15; i += 1) {
      const nextAvailability = this.probeAvailability();
      this.applyAvailability(nextAvailability);
      if (nextAvailability.hasSocket) {
        console.log('[InputInjector] ydotoold auto-start succeeded', {
          method: this.autoStartMethod,
          socketPath: nextAvailability.socketPath,
        });
        return;
      }
      await this.sleep(200);
    }

    // The daemon never produced a socket even though starting it "worked" —
    // usually it started and instantly died (no /dev/uinput access). Replace
    // the generic reason with an actionable one when we can tell why.
    this.diagnosedReason = (await this.diagnoseFailure()) ?? undefined;
    this.applyAvailability(this.probeAvailability());
  }

  async init(): Promise<InputBackendInitResult | undefined> {
    if (!this.supported && this.availability.hasBinary) {
      await this.attemptAutoStart();
    }

    if (!this.supported) {
      console.warn('[InputInjector] ydotool Wayland backend unavailable', {
        reason: this.reason,
        details: this.details,
      });
      return undefined;
    }

    // Try to detect the actual screen size so coordinate mapping is correct
    // from the first click. The host also calls updateScreenSize() once capture
    // starts, and that value wins, but init() runs before a session exists and
    // the 1920×1080 default maps a remote click ~2× off on a 4K display.
    //
    // Never fatal: a wrong-but-usable size beats no input injection at all.
    let detected: ScreenSize | null = null;
    try {
      detected = await this.detectScreenSize();
    } catch (error) {
      console.warn('[InputInjector] Wayland screen size detection failed', { error });
    }

    if (detected) {
      this.screenWidth = detected.width;
      this.screenHeight = detected.height;
    } else {
      console.warn(
        '[InputInjector] Could not detect Wayland screen size; ' +
          `defaulting to ${String(this.screenWidth)}x${String(this.screenHeight)}. ` +
          'Remote clicks may be off until a screen share starts.'
      );
    }

    return { screenWidth: this.screenWidth, screenHeight: this.screenHeight };
  }

  /**
   * Pointer position via the compositor, normalized 0-1.
   *
   * Null whenever KWin is not reporting — the injector then skips restoring
   * rather than moving the pointer somewhere wrong.
   */
  async dispose(): Promise<void> {
    await this.cursorProvider.stop();
  }

  /**
   * Begin asking the compositor for the pointer position.
   *
   * Deliberately not called from init(): this installs a hook into KWin's input
   * path, so it should only exist while someone actually has control.
   */
  async startCursorReporting(): Promise<void> {
    await this.cursorProvider.start();
  }

  getCursorPosition(): Promise<{ x: number; y: number } | null> {
    const point = this.cursorProvider.getPosition();
    if (!point) return Promise.resolve(null);

    return Promise.resolve({
      x: Math.min(1, Math.max(0, point.x / this.screenWidth)),
      y: Math.min(1, Math.max(0, point.y / this.screenHeight)),
    });
  }

  updateScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  private toAbsoluteCoords(relX: number, relY: number): { x: number; y: number } {
    return {
      x: Math.round(relX * this.screenWidth),
      y: Math.round(relY * this.screenHeight),
    };
  }

  private async move(event: MouseMoveEvent): Promise<void> {
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    await this.run(this.ydotoolCommand, ['mousemove', '--absolute', String(x), String(y)]);
  }

  private async mouseButton(event: MouseButtonEvent): Promise<void> {
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    const move = ['mousemove', '--absolute', String(x), String(y)];
    const click = ['click', ...clickCode(event.action, event.button)];

    if (isInputDebugEnabled()) {
      // The exact commands, because everything about a ydotool click succeeds
      // silently: exit 0 says the binary ran, not that the pointer moved. If
      // clicks land in the wrong place these coordinates and this screen size
      // are what to compare against the display's real geometry.
      console.log('[InputInjector:debug] ydotool button', {
        action: event.action,
        button: event.button,
        normalized: { x: event.x, y: event.y },
        screen: { width: this.screenWidth, height: this.screenHeight },
        commands: [move.join(' '), click.join(' ')],
      });
    }

    await this.run(this.ydotoolCommand, move);
    await this.run(this.ydotoolCommand, click);
  }

  private async scroll(event: MouseScrollEvent): Promise<void> {
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    await this.run(this.ydotoolCommand, ['mousemove', '--absolute', String(x), String(y)]);

    // ydotool click supports wheel buttons via synthetic click button codes:
    // button 4 (up), 5 (down), 6 (left), 7 (right) => bases 3,4,5,6.
    if (event.deltaY !== 0) {
      const repeat = scrollRepeat(event.deltaY);
      // DOM deltaY is positive when scrolling down, which is button 5 (base 4).
      const base = event.deltaY > 0 ? 0x04 : 0x03;
      await this.run(this.ydotoolCommand, ['click', ...scrollClickCode(base, repeat)]);
    }

    if (event.deltaX !== 0) {
      const repeat = scrollRepeat(event.deltaX);
      const base = event.deltaX > 0 ? 0x06 : 0x05;
      await this.run(this.ydotoolCommand, ['click', ...scrollClickCode(base, repeat)]);
    }
  }

  private async keyboard(event: KbEvent): Promise<void> {
    const keycode = keyCodeFromEvent(event);
    const modifiers = modifierKeycodes(event.modifiers);

    if (event.action === 'press' && modifiers.length === 0 && event.key.length === 1) {
      await this.run('ydotool', ['type', event.key]);
      return;
    }

    if (keycode == null) {
      if (event.action === 'press' && event.key.length > 0) {
        await this.run('ydotool', ['type', event.key]);
        return;
      }
      throw new Error(`Unsupported key for ydotool backend: ${event.key} (${event.code})`);
    }

    switch (event.action) {
      case 'down': {
        const tokens = [...modifiers.map((m) => keyToken(m, true)), keyToken(keycode, true)];
        await this.run(this.ydotoolCommand, ['key', ...tokens]);
        break;
      }
      case 'up': {
        const tokens = [
          keyToken(keycode, false),
          ...modifiers
            .slice()
            .reverse()
            .map((m) => keyToken(m, false)),
        ];
        await this.run(this.ydotoolCommand, ['key', ...tokens]);
        break;
      }
      case 'press': {
        const tokens = [
          ...modifiers.map((m) => keyToken(m, true)),
          keyToken(keycode, true),
          keyToken(keycode, false),
          ...modifiers
            .slice()
            .reverse()
            .map((m) => keyToken(m, false)),
        ];
        await this.run(this.ydotoolCommand, ['key', ...tokens]);
        break;
      }
    }
  }

  async inject(event: InputEvent): Promise<void> {
    if (!this.supported) {
      throw new Error(this.reason ?? 'Wayland ydotool backend unavailable');
    }

    switch (event.type) {
      case 'mouse':
        if (event.action === 'move') {
          await this.move(event);
        } else if (event.action === 'scroll') {
          await this.scroll(event);
        } else {
          await this.mouseButton(event);
        }
        break;
      case 'keyboard':
        await this.keyboard(event);
        break;
      default:
        throw new Error(
          `Unknown input event type: ${(event as { type?: string }).type ?? 'unknown'}`
        );
    }
  }

  async emergencyStop(): Promise<void> {
    if (!this.supported) return;
    await this.run(this.ydotoolCommand, [
      'key',
      keyToken(KEYCODES.ControlLeft, false),
      keyToken(KEYCODES.AltLeft, false),
      keyToken(KEYCODES.ShiftLeft, false),
      keyToken(KEYCODES.MetaLeft, false),
    ]);
    await this.run(this.ydotoolCommand, [
      'click',
      String(0x80 | 0x00),
      String(0x80 | 0x01),
      String(0x80 | 0x02),
    ]);
  }
}
