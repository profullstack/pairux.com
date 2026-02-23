/**
 * Input injection module using @nut-tree-fork/nut-js
 * Handles mouse and keyboard input injection for remote control
 *
 * The native nut-js module is loaded lazily (via dynamic import) so that the
 * heavy libnut.node addon is only initialised when input injection is actually
 * needed.  This avoids "open dir error" crashes on Linux when the AppImage's
 * working directory does not exist at startup.
 */

import type {
  InputEvent,
  MouseMoveEvent,
  MouseButtonEvent,
  MouseScrollEvent,
  KeyboardEvent as KbEvent,
  MouseButton,
} from '@pairux/shared-types';

// Helper that performs the one-time dynamic import and configures nut-js
async function loadNut() {
  const nut = await import('@nut-tree-fork/nut-js');
  nut.mouse.config.autoDelayMs = 0;
  nut.mouse.config.mouseSpeed = 10000; // Very fast movement
  nut.keyboard.config.autoDelayMs = 0;
  return nut;
}

// Derive a type from the helper so we never need `typeof import(...)`
type NutModule = Awaited<ReturnType<typeof loadNut>>;

// Memoised promise – avoids non-null assertions and double-init races
let _nutPromise: ReturnType<typeof loadNut> | null = null;

function getNut(): ReturnType<typeof loadNut> {
  _nutPromise ??= loadNut();
  return _nutPromise;
}

// Track if input injection is enabled (for safety)
let injectionEnabled = false;

// Track screen dimensions for coordinate conversion
let screenWidth = 1920;
let screenHeight = 1080;

/**
 * Initialize the input injector and get screen dimensions
 */
export async function initInputInjector(): Promise<void> {
  try {
    const { screen } = await getNut();
    const screenSize = await screen.width();
    const heightSize = await screen.height();
    screenWidth = screenSize;
    screenHeight = heightSize;
    console.log(`[InputInjector] Screen size: ${String(screenWidth)}x${String(screenHeight)}`);
  } catch (error) {
    console.error('[InputInjector] Failed to get screen size:', error);
    // Fall back to defaults
  }
}

/**
 * Enable input injection (called when control is granted)
 */
export function enableInjection(): void {
  injectionEnabled = true;
  console.log('[InputInjector] Input injection enabled');
}

/**
 * Disable input injection (called when control is revoked)
 */
export function disableInjection(): void {
  injectionEnabled = false;
  console.log('[InputInjector] Input injection disabled');
}

/**
 * Check if injection is currently enabled
 */
export function isInjectionEnabled(): boolean {
  return injectionEnabled;
}

/**
 * Update screen dimensions (called when capture source changes)
 */
export function updateScreenSize(width: number, height: number): void {
  screenWidth = width;
  screenHeight = height;
  console.log(
    `[InputInjector] Screen size updated: ${String(screenWidth)}x${String(screenHeight)}`
  );
}

/**
 * Convert relative coordinates (0-1) to absolute screen coordinates
 */
function toAbsoluteCoords(relX: number, relY: number): { x: number; y: number } {
  return {
    x: Math.round(relX * screenWidth),
    y: Math.round(relY * screenHeight),
  };
}

/**
 * Map mouse button string to nut.js Button enum
 */
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

/**
 * Map key code to nut.js Key enum
 * Handles both character keys and special keys
 */
function mapKey(
  key: string,
  code: string,
  Key: NutModule['Key']
): NutModule['Key'][keyof NutModule['Key']] | string {
  // Special keys mapping
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

  // Check if it's a special key
  if (specialKeys[key]) {
    return specialKeys[key];
  }

  // For regular character keys, return the lowercase character
  // nut.js can type strings directly
  if (key.length === 1) {
    return key;
  }

  // Fallback - try to find by code
  if (code.startsWith('Key')) {
    return code.slice(3).toLowerCase();
  }

  if (code.startsWith('Digit')) {
    return code.slice(5);
  }

  console.warn(`[InputInjector] Unknown key: ${key} (code: ${code})`);
  return key;
}

/**
 * Handle mouse move event
 */
async function handleMouseMove(event: MouseMoveEvent): Promise<void> {
  const { mouse } = await getNut();
  const { x, y } = toAbsoluteCoords(event.x, event.y);
  await mouse.setPosition({ x, y });
}

/**
 * Handle mouse button event
 */
async function handleMouseButton(event: MouseButtonEvent): Promise<void> {
  const { mouse, Button } = await getNut();
  const { x, y } = toAbsoluteCoords(event.x, event.y);
  const button = mapMouseButton(event.button, Button);

  // Move to position first
  await mouse.setPosition({ x, y });

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

/**
 * Handle mouse scroll event
 */
async function handleMouseScroll(event: MouseScrollEvent): Promise<void> {
  const { mouse } = await getNut();
  const { x, y } = toAbsoluteCoords(event.x, event.y);

  // Move to position first
  await mouse.setPosition({ x, y });

  // Scroll - nut.js uses positive values for scrolling down
  // Convert from typical wheel delta (negative = scroll down)
  if (event.deltaY !== 0) {
    const scrollAmount = Math.abs(Math.round(event.deltaY / 100)) || 1;
    if (event.deltaY < 0) {
      await mouse.scrollDown(scrollAmount);
    } else {
      await mouse.scrollUp(scrollAmount);
    }
  }

  if (event.deltaX !== 0) {
    const scrollAmount = Math.abs(Math.round(event.deltaX / 100)) || 1;
    if (event.deltaX > 0) {
      await mouse.scrollRight(scrollAmount);
    } else {
      await mouse.scrollLeft(scrollAmount);
    }
  }
}

/**
 * Handle keyboard event
 */
async function handleKeyboard(event: KbEvent): Promise<void> {
  const { keyboard, Key } = await getNut();
  const key = mapKey(event.key, event.code, Key);
  const { modifiers } = event;

  // Build list of modifier keys to hold
  const modifierKeys: NutModule['Key'][keyof NutModule['Key']][] = [];
  if (modifiers.ctrl) modifierKeys.push(Key.LeftControl);
  if (modifiers.alt) modifierKeys.push(Key.LeftAlt);
  if (modifiers.shift) modifierKeys.push(Key.LeftShift);
  if (modifiers.meta) modifierKeys.push(Key.LeftSuper);

  switch (event.action) {
    case 'down':
      // Press modifiers first
      for (const mod of modifierKeys) {
        await keyboard.pressKey(mod);
      }
      // Then the key
      if (typeof key === 'string') {
        // For string keys, we need to type them
        await keyboard.type(key);
      } else {
        await keyboard.pressKey(key);
      }
      break;

    case 'up':
      // Release the key first
      if (typeof key !== 'string') {
        await keyboard.releaseKey(key);
      }
      // Then release modifiers
      for (const mod of modifierKeys.reverse()) {
        await keyboard.releaseKey(mod);
      }
      break;

    case 'press':
      // Press and release - handle modifiers
      if (modifierKeys.length > 0 || typeof key !== 'string') {
        // Press modifiers
        for (const mod of modifierKeys) {
          await keyboard.pressKey(mod);
        }
        // Press and release the key
        if (typeof key === 'string') {
          await keyboard.type(key);
        } else {
          await keyboard.pressKey(key);
          await keyboard.releaseKey(key);
        }
        // Release modifiers
        for (const mod of modifierKeys.reverse()) {
          await keyboard.releaseKey(mod);
        }
      } else {
        // Simple character - just type it
        await keyboard.type(key);
      }
      break;
  }
}

/**
 * Inject an input event
 * Main entry point for processing incoming input events
 */
export async function injectInput(event: InputEvent): Promise<void> {
  if (!injectionEnabled) {
    console.warn('[InputInjector] Input injection not enabled, ignoring event');
    return;
  }

  try {
    switch (event.type) {
      case 'mouse':
        if (event.action === 'move') {
          await handleMouseMove(event);
        } else if (event.action === 'scroll') {
          await handleMouseScroll(event);
        } else {
          await handleMouseButton(event);
        }
        break;

      case 'keyboard':
        await handleKeyboard(event);
        break;

      default:
        console.warn('[InputInjector] Unknown event type:', event);
    }
  } catch (error) {
    console.error('[InputInjector] Failed to inject input:', error);
  }
}

/**
 * Emergency stop - release all keys and buttons
 */
export async function emergencyStop(): Promise<void> {
  console.log('[InputInjector] Emergency stop triggered');
  disableInjection();

  try {
    const { keyboard, mouse, Key, Button } = await getNut();

    // Release common modifier keys
    await keyboard.releaseKey(Key.LeftControl);
    await keyboard.releaseKey(Key.LeftAlt);
    await keyboard.releaseKey(Key.LeftShift);
    await keyboard.releaseKey(Key.LeftSuper);
    await keyboard.releaseKey(Key.RightControl);
    await keyboard.releaseKey(Key.RightAlt);
    await keyboard.releaseKey(Key.RightShift);
    await keyboard.releaseKey(Key.RightSuper);

    // Release mouse buttons
    await mouse.releaseButton(Button.LEFT);
    await mouse.releaseButton(Button.RIGHT);
    await mouse.releaseButton(Button.MIDDLE);
  } catch (error) {
    console.error('[InputInjector] Error during emergency stop:', error);
  }
}
