import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type {
  InputEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  MouseScrollEvent,
  KeyboardEvent as KbEvent,
  MouseButton,
} from '@pairux/shared-types';
import type { InputBackend, InputBackendInitResult } from './types';

type ExecRunner = (command: string, args: string[]) => Promise<void>;

interface YdotoolAvailability {
  hasBinary: boolean;
  hasSocket: boolean;
  socketPath: string | null;
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

function hasYdotoolBinary(): boolean {
  try {
    execFileSync('ydotool', ['--help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findYdotoolSocket(): string | null {
  const candidates = [
    process.env.YDOTOOL_SOCKET,
    process.env.XDG_RUNTIME_DIR ? `${process.env.XDG_RUNTIME_DIR}/.ydotool_socket` : undefined,
    '/tmp/.ydotool_socket',
  ].filter((value): value is string => Boolean(value));

  return candidates.find((path) => existsSync(path)) ?? null;
}

function getYdotoolAvailability(): YdotoolAvailability {
  const hasBinary = hasYdotoolBinary();
  const socketPath = findYdotoolSocket();
  return {
    hasBinary,
    hasSocket: Boolean(socketPath),
    socketPath,
  };
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

const KEYCODES: Record<string, number> = {
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
};

function keyCodeFromEvent(event: KbEvent): number | null {
  if (KEYCODES[event.code]) return KEYCODES[event.code];

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
  const keys: number[] = [];
  if (modifiers.ctrl) keys.push(KEYCODES.ControlLeft);
  if (modifiers.alt) keys.push(KEYCODES.AltLeft);
  if (modifiers.shift) keys.push(KEYCODES.ShiftLeft);
  if (modifiers.meta) keys.push(KEYCODES.MetaLeft);
  return keys;
}

function keyToken(code: number, down: boolean): string {
  return `${String(code)}:${down ? '1' : '0'}`;
}

export class WaylandYdotoolInputBackend implements InputBackend {
  readonly name = 'wayland-ydotool';
  readonly supported: boolean;
  readonly reason?: string;
  readonly details?: Record<string, unknown>;
  private screenWidth = 1920;
  private screenHeight = 1080;
  private readonly run: ExecRunner;

  constructor(
    run: ExecRunner = defaultExecRunner,
    availability: YdotoolAvailability = getYdotoolAvailability()
  ) {
    this.run = run;
    this.supported = availability.hasBinary && availability.hasSocket;
    this.details = {
      hasYdotoolBinary: availability.hasBinary,
      hasYdotoolSocket: availability.hasSocket,
      ydotoolSocketPath: availability.socketPath,
    };
    if (!availability.hasBinary) {
      this.reason = 'Wayland support requires `ydotool` to be installed.';
    } else if (!availability.hasSocket) {
      this.reason = 'Wayland support requires `ydotoold` to be running (no ydotool socket found).';
    }
  }

  init(): Promise<InputBackendInitResult | undefined> {
    if (!this.supported) {
      console.warn('[InputInjector] ydotool Wayland backend unavailable', {
        reason: this.reason,
        details: this.details,
      });
      return Promise.resolve(undefined);
    }
    return Promise.resolve({ screenWidth: this.screenWidth, screenHeight: this.screenHeight });
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
    await this.run('ydotool', ['mousemove', '--absolute', String(x), String(y)]);
  }

  private async mouseButton(event: MouseButtonEvent): Promise<void> {
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    await this.run('ydotool', ['mousemove', '--absolute', String(x), String(y)]);
    await this.run('ydotool', ['click', ...clickCode(event.action, event.button)]);
  }

  private async scroll(event: MouseScrollEvent): Promise<void> {
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    await this.run('ydotool', ['mousemove', '--absolute', String(x), String(y)]);

    // ydotool click supports wheel buttons via synthetic click button codes:
    // button 4 (up), 5 (down), 6 (left), 7 (right) => bases 3,4,5,6.
    if (event.deltaY !== 0) {
      const repeat = scrollRepeat(event.deltaY);
      const base = event.deltaY > 0 ? 0x03 : 0x04;
      await this.run('ydotool', ['click', ...scrollClickCode(base, repeat)]);
    }

    if (event.deltaX !== 0) {
      const repeat = scrollRepeat(event.deltaX);
      const base = event.deltaX > 0 ? 0x06 : 0x05;
      await this.run('ydotool', ['click', ...scrollClickCode(base, repeat)]);
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
        await this.run('ydotool', ['key', ...tokens]);
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
        await this.run('ydotool', ['key', ...tokens]);
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
        await this.run('ydotool', ['key', ...tokens]);
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
    await this.run('ydotool', [
      'key',
      keyToken(KEYCODES.ControlLeft, false),
      keyToken(KEYCODES.AltLeft, false),
      keyToken(KEYCODES.ShiftLeft, false),
      keyToken(KEYCODES.MetaLeft, false),
    ]);
    await this.run('ydotool', [
      'click',
      String(0x80 | 0x00),
      String(0x80 | 0x01),
      String(0x80 | 0x02),
    ]);
  }
}
