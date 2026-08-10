import { resolveModifiers } from '../modifiers.js';
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

// Helper that performs the one-time dynamic import and configures nut-js
async function loadNut() {
  const nut = await import('@nut-tree-fork/nut-js');
  nut.mouse.config.autoDelayMs = 0;
  nut.mouse.config.mouseSpeed = 10000;
  nut.keyboard.config.autoDelayMs = 0;
  return nut;
}

type NutModule = Awaited<ReturnType<typeof loadNut>>;

/**
 * How long to wait for a synthetic pointer move to be applied before acting on
 * it. Roughly one frame — long enough for the window server, short enough that
 * remote input still feels immediate.
 */
const POSITION_SETTLE_MS = 16;

function settle(ms: number = POSITION_SETTLE_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nutPromise: ReturnType<typeof loadNut> | null = null;

function getNut(): ReturnType<typeof loadNut> {
  nutPromise ??= loadNut();
  return nutPromise;
}

function mapMouseButton(button: MouseButton, Button: NutModule['Button']) {
  switch (button) {
    case 'left':
      return Button.LEFT;
    case 'right':
      return Button.RIGHT;
    case 'middle':
      return Button.MIDDLE;
    default:
      return Button.LEFT;
  }
}

function mapKey(
  key: string,
  code: string,
  Key: NutModule['Key']
): NutModule['Key'][keyof NutModule['Key']] | string {
  const specialKeys: Record<string, NutModule['Key'][keyof NutModule['Key']]> = {
    Enter: Key.Enter,
    Tab: Key.Tab,
    Escape: Key.Escape,
    Backspace: Key.Backspace,
    Delete: Key.Delete,
    Insert: Key.Insert,
    Home: Key.Home,
    End: Key.End,
    PageUp: Key.PageUp,
    PageDown: Key.PageDown,
    ArrowUp: Key.Up,
    ArrowDown: Key.Down,
    ArrowLeft: Key.Left,
    ArrowRight: Key.Right,
    Space: Key.Space,
    ' ': Key.Space,
    Control: Key.LeftControl,
    Shift: Key.LeftShift,
    Alt: Key.LeftAlt,
    Meta: Key.LeftSuper,
    CapsLock: Key.CapsLock,
    NumLock: Key.NumLock,
    ScrollLock: Key.ScrollLock,
    PrintScreen: Key.Print,
    Pause: Key.Pause,
    F1: Key.F1,
    F2: Key.F2,
    F3: Key.F3,
    F4: Key.F4,
    F5: Key.F5,
    F6: Key.F6,
    F7: Key.F7,
    F8: Key.F8,
    F9: Key.F9,
    F10: Key.F10,
    F11: Key.F11,
    F12: Key.F12,
  };

  if (specialKeys[key]) return specialKeys[key];
  if (key.length === 1) return key;
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);

  console.warn(`[InputInjector] Unknown key: ${key} (code: ${code})`);
  return key;
}

export class NutJsInputBackend implements InputBackend {
  readonly name = 'nut-js';
  readonly supported = true;
  private screenWidth = 1920;
  private screenHeight = 1080;

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

  /** Normalized so the injector can restore it without knowing the screen. */
  async getCursorPosition(): Promise<{ x: number; y: number } | null> {
    try {
      const { mouse } = await getNut();
      const point = await mouse.getPosition();
      return {
        x: Math.min(1, Math.max(0, point.x / this.screenWidth)),
        y: Math.min(1, Math.max(0, point.y / this.screenHeight)),
      };
    } catch {
      return null;
    }
  }

  async init(): Promise<InputBackendInitResult> {
    const { screen } = await getNut();
    this.screenWidth = await screen.width();
    this.screenHeight = await screen.height();
    return { screenWidth: this.screenWidth, screenHeight: this.screenHeight };
  }

  private async handleMouseMove(event: MouseMoveEvent): Promise<void> {
    const { mouse } = await getNut();
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    await mouse.setPosition({ x, y });
  }

  private async handleMouseButton(event: MouseButtonEvent): Promise<void> {
    const { mouse, Button } = await getNut();
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    const button = mapMouseButton(event.button, Button);

    await mouse.setPosition({ x, y });
    // Let the pointer actually arrive before pressing.
    //
    // autoDelayMs is 0, so without this the position change and the button
    // event are issued back to back. macOS applies a synthetic move through
    // the window server asynchronously, so the press can be delivered before
    // the pointer has moved — the click lands wherever the pointer used to be.
    //
    // It also puts a real gap between press and release. Two-cursor mode
    // borrows the pointer, clicks, and hands it straight back, which without
    // a delay is a sub-millisecond blip that many controls simply ignore.
    await settle();

    switch (event.action) {
      case 'down':
        await mouse.pressButton(button);
        break;
      case 'up':
        await mouse.releaseButton(button);
        break;
      case 'click':
        await mouse.click(button);
        break;
      case 'dblclick':
        await mouse.doubleClick(button);
        break;
    }
  }

  private async handleMouseScroll(event: MouseScrollEvent): Promise<void> {
    const { mouse } = await getNut();
    const { x, y } = this.toAbsoluteCoords(event.x, event.y);
    await mouse.setPosition({ x, y });

    if (event.deltaY !== 0) {
      const scrollAmount = Math.abs(Math.round(event.deltaY / 100)) || 1;
      // DOM deltaY is positive when scrolling down.
      if (event.deltaY > 0) await mouse.scrollDown(scrollAmount);
      else await mouse.scrollUp(scrollAmount);
    }

    if (event.deltaX !== 0) {
      const scrollAmount = Math.abs(Math.round(event.deltaX / 100)) || 1;
      if (event.deltaX > 0) await mouse.scrollRight(scrollAmount);
      else await mouse.scrollLeft(scrollAmount);
    }
  }

  private async handleKeyboard(event: KbEvent): Promise<void> {
    const { keyboard, Key } = await getNut();
    const key = mapKey(event.key, event.code, Key);
    const { modifiers } = event;

    // Resolved against *this* host, so a Mac viewer's Cmd+C becomes Ctrl+C here
    // rather than Super+C, and vice versa. LeftSuper is Cmd on macOS.
    const resolved = resolveModifiers(modifiers, process.platform);
    const modifierKeys: NutModule['Key'][keyof NutModule['Key']][] = [];
    if (resolved.control) modifierKeys.push(Key.LeftControl);
    if (resolved.alt) modifierKeys.push(Key.LeftAlt);
    if (resolved.shift) modifierKeys.push(Key.LeftShift);
    if (resolved.meta) modifierKeys.push(Key.LeftSuper);

    switch (event.action) {
      case 'down':
        for (const mod of modifierKeys) await keyboard.pressKey(mod);
        if (typeof key === 'string') await keyboard.type(key);
        else await keyboard.pressKey(key);
        break;
      case 'up':
        if (typeof key !== 'string') await keyboard.releaseKey(key);
        for (const mod of modifierKeys.reverse()) await keyboard.releaseKey(mod);
        break;
      case 'press':
        if (modifierKeys.length > 0 || typeof key !== 'string') {
          for (const mod of modifierKeys) await keyboard.pressKey(mod);
          if (typeof key === 'string') await keyboard.type(key);
          else {
            await keyboard.pressKey(key);
            await keyboard.releaseKey(key);
          }
          for (const mod of modifierKeys.reverse()) await keyboard.releaseKey(mod);
        } else {
          await keyboard.type(key);
        }
        break;
    }
  }

  async inject(event: InputEvent): Promise<void> {
    switch (event.type) {
      case 'mouse':
        if (event.action === 'move') await this.handleMouseMove(event);
        else if (event.action === 'scroll') await this.handleMouseScroll(event);
        else await this.handleMouseButton(event);
        break;
      case 'keyboard':
        await this.handleKeyboard(event);
        break;
      default:
        console.warn('[InputInjector] Unknown event type:', event);
    }
  }

  async emergencyStop(): Promise<void> {
    const { keyboard, mouse, Key, Button } = await getNut();

    await keyboard.releaseKey(Key.LeftControl);
    await keyboard.releaseKey(Key.LeftAlt);
    await keyboard.releaseKey(Key.LeftShift);
    await keyboard.releaseKey(Key.LeftSuper);
    await keyboard.releaseKey(Key.RightControl);
    await keyboard.releaseKey(Key.RightAlt);
    await keyboard.releaseKey(Key.RightShift);
    await keyboard.releaseKey(Key.RightSuper);

    await mouse.releaseButton(Button.LEFT);
    await mouse.releaseButton(Button.RIGHT);
    await mouse.releaseButton(Button.MIDDLE);
  }
}
