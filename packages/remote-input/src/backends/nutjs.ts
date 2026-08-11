import { resolveModifiers } from '../modifiers.js';
import { resolveKey, isSingleCharacter } from '../keymap.js';
import { ScrollAccumulator } from '../scroll.js';
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
  CaptureBounds,
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

type NutKeyValue = NutModule['Key'][keyof NutModule['Key']];

/**
 * Look a nut.js `Key` member up by name.
 *
 * The keymap deals in names so it can stay free of the nut.js import; this is
 * the one place that turns a name back into the enum value. Returns undefined
 * for a name this build of nut.js does not have, which the caller must treat as
 * "cannot press that" rather than pressing something arbitrary.
 */
function nutKey(Key: NutModule['Key'], name: string): NutKeyValue | undefined {
  // Presence, not shape: the enum member either exists in this build or it does
  // not. Insisting on a number would reject any host that hands us an enum
  // represented some other way, and silently drop every key it names.
  return (Key as unknown as Record<string, NutKeyValue | undefined>)[name];
}

/** Which nut.js modifier keys a resolved modifier set means. */
function modifierKeyNames(resolved: ReturnType<typeof resolveModifiers>): Set<string> {
  const names = new Set<string>();
  if (resolved.control) names.add('LeftControl');
  if (resolved.alt) names.add('LeftAlt');
  if (resolved.shift) names.add('LeftShift');
  if (resolved.meta) names.add('LeftSuper');
  return names;
}

export class NutJsInputBackend implements InputBackend {
  readonly name = 'nut-js';
  readonly supported = true;
  private screenWidth = 1920;
  private screenHeight = 1080;
  /** nut.js key names this backend is currently holding down. See applyModifiers. */
  private readonly heldModifiers = new Set<string>();
  /** One per axis, so a fraction of a notch is carried rather than rounded up. */
  private readonly scrollX = new ScrollAccumulator();
  private readonly scrollY = new ScrollAccumulator();
  /** The shared region of the desktop, or null for "the whole primary screen". */
  private captureBounds: CaptureBounds | null = null;

  updateScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  updateCaptureBounds(bounds: CaptureBounds | null): void {
    this.captureBounds = bounds;
  }

  /**
   * The rectangle the viewer's 0-1 coordinates are relative to.
   *
   * Falls back to the primary display, which is what the whole path assumed
   * before capture bounds existed — right for a single-monitor host, and the
   * reason a second monitor put every click on the wrong screen.
   */
  private surface(): CaptureBounds {
    return this.captureBounds ?? { x: 0, y: 0, width: this.screenWidth, height: this.screenHeight };
  }

  private toAbsoluteCoords(relX: number, relY: number): { x: number; y: number } {
    const { x, y, width, height } = this.surface();
    return {
      x: Math.round(x + relX * width),
      y: Math.round(y + relY * height),
    };
  }

  /** Normalized so the injector can restore it without knowing the screen. */
  async getCursorPosition(): Promise<{ x: number; y: number } | null> {
    try {
      const { mouse } = await getNut();
      const point = await mouse.getPosition();
      const { x, y, width, height } = this.surface();
      return {
        x: Math.min(1, Math.max(0, (point.x - x) / width)),
        y: Math.min(1, Math.max(0, (point.y - y) / height)),
      };
    } catch {
      return null;
    }
  }

  async init(): Promise<InputBackendInitResult> {
    const { screen } = await getNut();
    this.screenWidth = await screen.width();
    this.screenHeight = await screen.height();

    if (isInputDebugEnabled()) {
      // The other half of a mis-placed click: if this disagrees with the
      // display's real geometry (Retina reporting physical pixels while
      // setPosition expects logical points, say), every coordinate is scaled
      // wrong and no settle delay will save it.
      console.log('[InputInjector:debug] screen geometry from nut-js', {
        width: this.screenWidth,
        height: this.screenHeight,
        platform: process.platform,
      });
    }

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

    if (isInputDebugEnabled()) {
      // Read the pointer back from the OS. If `actual` does not match
      // `requested` here, the settle above is too short and the click is
      // landing somewhere other than where the guest aimed.
      let actual: { x: number; y: number } | null = null;
      try {
        actual = await mouse.getPosition();
      } catch (error) {
        console.warn('[InputInjector:debug] could not read pointer back', { error });
      }

      console.log('[InputInjector:debug] button', {
        action: event.action,
        button: event.button,
        normalized: { x: event.x, y: event.y },
        requested: { x, y },
        actual,
        drift: actual ? { x: actual.x - x, y: actual.y - y } : null,
        screen: { width: this.screenWidth, height: this.screenHeight },
      });
    }

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

    // Fractions of a notch carry over rather than rounding up, so a trackpad's
    // stream of 3px deltas adds up to one notch instead of one notch each.
    const notchesY = this.scrollY.add(event.deltaY, event.deltaMode);
    if (notchesY !== 0) {
      // DOM deltaY is positive when scrolling down.
      if (notchesY > 0) await mouse.scrollDown(notchesY);
      else await mouse.scrollUp(-notchesY);
    }

    const notchesX = this.scrollX.add(event.deltaX, event.deltaMode);
    if (notchesX !== 0) {
      if (notchesX > 0) await mouse.scrollRight(notchesX);
      else await mouse.scrollLeft(-notchesX);
    }
  }

  /**
   * Bring the host's held modifiers in line with what the viewer is holding.
   *
   * Modifiers are driven from the `modifiers` field alone, never from the
   * modifier key events, because that field restates the whole truth on every
   * single event. That is what makes this self-healing: if a Cmd release is
   * lost to a dropped packet or a viewer that lost focus mid-chord, the very
   * next keystroke carries `accel: false` and the modifier comes back up. The
   * previous code pressed the whole snapshot before each key and released it
   * after each key-up, which dropped a held Shift in the middle of a word and
   * left the host's modifier state guessing between two sources.
   */
  private async applyModifiers(desired: Set<string>): Promise<void> {
    const { keyboard, Key } = await getNut();

    // Release first: going from Ctrl+Shift to Ctrl should not momentarily hold
    // a modifier the viewer has already let go of.
    for (const name of [...this.heldModifiers]) {
      if (desired.has(name)) continue;
      const key = nutKey(Key, name);
      if (key !== undefined) await keyboard.releaseKey(key);
      this.heldModifiers.delete(name);
    }

    for (const name of desired) {
      if (this.heldModifiers.has(name)) continue;
      const key = nutKey(Key, name);
      if (key === undefined) continue;
      await keyboard.pressKey(key);
      this.heldModifiers.add(name);
    }
  }

  private async handleKeyboard(event: KbEvent): Promise<void> {
    const { keyboard, Key } = await getNut();

    const resolved = resolveKey(event, process.platform);
    if (resolved === null) {
      // The code, never the character: this is the host's own typing, and a key
      // name in a log file is a keylogger by another name.
      console.warn('[InputInjector] No mapping for key', { code: event.code });
      return;
    }

    // Resolved against *this* host, so a Mac viewer's Cmd+C becomes Ctrl+C here
    // rather than Super+C, and vice versa. LeftSuper is Cmd on macOS.
    const wanted = modifierKeyNames(resolveModifiers(event.modifiers, process.platform));

    // A modifier key event carries no work of its own — the snapshot above
    // already says whether it should be down, and pressing it separately would
    // press it twice and release it once.
    if (resolved.kind === 'modifier') {
      await this.applyModifiers(wanted);
      return;
    }

    if (resolved.kind === 'text') {
      // Shift and Alt are deliberately dropped here. The viewer sent the
      // character their layout produced — '@', not Shift+2 — so holding Shift
      // while typing it applies the shift a second time and lands on a
      // different character entirely on any non-US layout.
      await this.applyModifiers(new Set());
      if (event.action !== 'up') await keyboard.type(resolved.text);
      return;
    }

    const key = nutKey(Key, resolved.name);
    if (key === undefined) {
      // This build of nut.js cannot name that physical key. If the viewer sent
      // a character, typing it still gets the keystroke across — with the
      // modifiers held, so Ctrl+C is a copy rather than a stray 'c'. Dropping
      // the event instead would make the key silently do nothing.
      if (isSingleCharacter(event.key)) {
        await this.applyModifiers(wanted);
        if (event.action !== 'up') await keyboard.type(event.key);
        if (event.action === 'press') await this.applyModifiers(new Set());
        return;
      }

      console.warn('[InputInjector] Host keyboard has no such key', { name: resolved.name });
      return;
    }

    switch (event.action) {
      case 'down':
        await this.applyModifiers(wanted);
        await keyboard.pressKey(key);
        break;
      case 'up':
        await keyboard.releaseKey(key);
        // After the key, so a chord releases in the order a human would.
        await this.applyModifiers(wanted);
        break;
      case 'press':
        // A complete keystroke, not half of a pair, so it leaves nothing held.
        // A viewer who really is still holding the modifier re-states it on the
        // next event and applyModifiers presses it straight back.
        await this.applyModifiers(wanted);
        await keyboard.pressKey(key);
        await keyboard.releaseKey(key);
        await this.applyModifiers(new Set());
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

    // Everything below is released unconditionally, so the tracked set is now
    // wrong in the safe direction. Clearing it means the next chord presses the
    // modifiers it needs instead of assuming they are already down.
    this.heldModifiers.clear();
    // A half-notch of leftover scroll must not surface in whatever happens next.
    this.scrollX.reset();
    this.scrollY.reset();

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
