import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  MouseMoveEvent,
  MouseButtonEvent,
  MouseScrollEvent,
  KeyboardEvent,
} from '@pairux/shared-types';

vi.mock('../platform', () => ({
  detectDisplayServer: vi.fn().mockReturnValue('x11'),
}));

vi.mock('../capture/captureDisplay', () => ({
  resolveCaptureBoundsForSource: vi.fn().mockResolvedValue(null),
}));

// Mock @nut-tree-fork/nut-js before imports
// Note: All values must be defined inside the factory since vi.mock is hoisted
vi.mock('@nut-tree-fork/nut-js', () => {
  // Create Key enum values as objects so typeof !== 'string' works correctly
  const KeyValues = {
    Enter: { name: 'Enter' },
    Tab: { name: 'Tab' },
    Escape: { name: 'Escape' },
    Backspace: { name: 'Backspace' },
    Delete: { name: 'Delete' },
    Insert: { name: 'Insert' },
    Home: { name: 'Home' },
    End: { name: 'End' },
    PageUp: { name: 'PageUp' },
    PageDown: { name: 'PageDown' },
    Up: { name: 'Up' },
    Down: { name: 'Down' },
    Left: { name: 'Left' },
    Right: { name: 'Right' },
    Space: { name: 'Space' },
    LeftControl: { name: 'LeftControl' },
    LeftShift: { name: 'LeftShift' },
    LeftAlt: { name: 'LeftAlt' },
    LeftSuper: { name: 'LeftSuper' },
    RightControl: { name: 'RightControl' },
    RightShift: { name: 'RightShift' },
    RightAlt: { name: 'RightAlt' },
    RightSuper: { name: 'RightSuper' },
    CapsLock: { name: 'CapsLock' },
    NumLock: { name: 'NumLock' },
    ScrollLock: { name: 'ScrollLock' },
    Print: { name: 'Print' },
    Pause: { name: 'Pause' },
    F1: { name: 'F1' },
    F2: { name: 'F2' },
    F3: { name: 'F3' },
    F4: { name: 'F4' },
    F5: { name: 'F5' },
    F6: { name: 'F6' },
    F7: { name: 'F7' },
    F8: { name: 'F8' },
    F9: { name: 'F9' },
    F10: { name: 'F10' },
    F11: { name: 'F11' },
    F12: { name: 'F12' },
  };

  const ButtonValues = {
    LEFT: 0,
    RIGHT: 1,
    MIDDLE: 2,
  };

  return {
    mouse: {
      config: { autoDelayMs: 0, mouseSpeed: 10000 },
      setPosition: vi.fn(),
      getPosition: vi.fn().mockResolvedValue({ x: 1700, y: 900 }),
      pressButton: vi.fn(),
      releaseButton: vi.fn(),
      click: vi.fn(),
      doubleClick: vi.fn(),
      scrollUp: vi.fn(),
      scrollDown: vi.fn(),
      scrollLeft: vi.fn(),
      scrollRight: vi.fn(),
    },
    keyboard: {
      config: { autoDelayMs: 0 },
      pressKey: vi.fn(),
      releaseKey: vi.fn(),
      type: vi.fn(),
    },
    screen: {
      width: vi.fn().mockResolvedValue(1920),
      height: vi.fn().mockResolvedValue(1080),
    },
    Button: ButtonValues,
    Key: KeyValues,
  };
});

import { mouse, keyboard, Button, Key, screen } from '@nut-tree-fork/nut-js';
import { resolveCaptureBoundsForSource } from '../capture/captureDisplay';
import {
  initInputInjector,
  enableInjection,
  disableInjection,
  isInjectionEnabled,
  updateScreenSize,
  injectInput,
  emergencyStop,
  resetInputInjector,
  setCaptureSource,
} from './injector';

describe('Input Injector', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetInputInjector();
    // Reset injection state and screen size
    disableInjection();
    // Reset to default screen size for consistent tests
    updateScreenSize(1920, 1080);
  });

  afterEach(() => {
    disableInjection();
  });

  describe('initInputInjector', () => {
    it('should initialize and get screen dimensions', async () => {
      await initInputInjector();

      expect(screen.width).toHaveBeenCalled();
      expect(screen.height).toHaveBeenCalled();
    });

    it('should handle screen dimension errors gracefully', async () => {
      vi.mocked(screen.width).mockRejectedValueOnce(new Error('Screen error'));

      // Should not throw
      await expect(initInputInjector()).resolves.not.toThrow();
    });

    it('re-resolves a source selected before backend geometry was initialized', async () => {
      await setCaptureSource('screen:second');
      await initInputInjector();

      expect(resolveCaptureBoundsForSource).toHaveBeenLastCalledWith('screen:second', {
        width: 1920,
        height: 1080,
      });
    });
  });

  describe('enableInjection / disableInjection', () => {
    it('should enable injection', () => {
      expect(isInjectionEnabled()).toBe(false);

      enableInjection();

      expect(isInjectionEnabled()).toBe(true);
    });

    it('should disable injection', () => {
      enableInjection();
      expect(isInjectionEnabled()).toBe(true);

      disableInjection();

      expect(isInjectionEnabled()).toBe(false);
    });
  });

  describe('updateScreenSize', () => {
    it('should update screen dimensions', () => {
      updateScreenSize(2560, 1440);
      // The function updates internal state - verified in afterEach cleanup
    });
  });

  describe('injectInput', () => {
    beforeEach(() => {
      // Ensure default screen size before each input test
      updateScreenSize(1920, 1080);
      enableInjection();
    });

    it('should not inject if injection is disabled', async () => {
      disableInjection();

      const event: MouseMoveEvent = {
        type: 'mouse',
        action: 'move',
        x: 0.5,
        y: 0.5,
      };

      await injectInput(event);

      expect(mouse.setPosition).not.toHaveBeenCalled();
    });

    describe('mouse move events', () => {
      it('moves the host pointer continuously for remote movement', async () => {
        const event: MouseMoveEvent = {
          type: 'mouse',
          action: 'move',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.setPosition).toHaveBeenCalledWith({ x: 960, y: 540 });
      });

      it('positions the pointer at the remote cursor when a click lands', async () => {
        await injectInput({ type: 'mouse', action: 'move', x: 0.25, y: 0.75 });
        await injectInput({
          type: 'mouse',
          action: 'down',
          button: 'left',
          x: 0.25,
          y: 0.75,
        });

        // 0.25/0.75 of the mocked 1920x1080 screen.
        expect(mouse.setPosition).toHaveBeenCalledWith({ x: 480, y: 810 });
      });
    });

    describe('mouse button events', () => {
      it('should handle mouse click event', async () => {
        const event: MouseButtonEvent = {
          type: 'mouse',
          action: 'click',
          button: 'left',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.setPosition).toHaveBeenCalledWith({ x: 960, y: 540 });
        expect(mouse.click).toHaveBeenCalledWith(Button.LEFT);
      });

      it('should handle mouse double click event', async () => {
        const event: MouseButtonEvent = {
          type: 'mouse',
          action: 'dblclick',
          button: 'left',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.doubleClick).toHaveBeenCalledWith(Button.LEFT);
      });

      it('should handle mouse down event', async () => {
        const event: MouseButtonEvent = {
          type: 'mouse',
          action: 'down',
          button: 'left',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.pressButton).toHaveBeenCalledWith(Button.LEFT);
      });

      it('should handle mouse up event', async () => {
        const event: MouseButtonEvent = {
          type: 'mouse',
          action: 'up',
          button: 'left',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.releaseButton).toHaveBeenCalledWith(Button.LEFT);
      });

      it('should handle right mouse button', async () => {
        const event: MouseButtonEvent = {
          type: 'mouse',
          action: 'click',
          button: 'right',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.click).toHaveBeenCalledWith(Button.RIGHT);
      });

      it('should handle middle mouse button', async () => {
        const event: MouseButtonEvent = {
          type: 'mouse',
          action: 'click',
          button: 'middle',
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.click).toHaveBeenCalledWith(Button.MIDDLE);
      });
    });

    describe('mouse scroll events', () => {
      // DOM WheelEvent: positive deltaY is a scroll *down*. Both backends had
      // this backwards, so every remote scroll went the wrong way.
      it('scrolls down for positive deltaY', async () => {
        const event: MouseScrollEvent = {
          type: 'mouse',
          action: 'scroll',
          deltaX: 0,
          deltaY: 120,
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.setPosition).toHaveBeenCalled();
        expect(mouse.scrollDown).toHaveBeenCalled();
        expect(mouse.scrollUp).not.toHaveBeenCalled();
      });

      it('scrolls up for negative deltaY', async () => {
        const event: MouseScrollEvent = {
          type: 'mouse',
          action: 'scroll',
          deltaX: 0,
          deltaY: -120,
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.scrollUp).toHaveBeenCalled();
      });

      it('should handle horizontal scroll right', async () => {
        const event: MouseScrollEvent = {
          type: 'mouse',
          action: 'scroll',
          deltaX: 120,
          deltaY: 0,
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.scrollRight).toHaveBeenCalled();
      });

      it('should handle horizontal scroll left', async () => {
        const event: MouseScrollEvent = {
          type: 'mouse',
          action: 'scroll',
          deltaX: -120,
          deltaY: 0,
          x: 0.5,
          y: 0.5,
        };

        await injectInput(event);

        expect(mouse.scrollLeft).toHaveBeenCalled();
      });
    });

    describe('keyboard events', () => {
      it('should handle key down event for character keys', async () => {
        const event: KeyboardEvent = {
          type: 'keyboard',
          action: 'down',
          key: 'a',
          code: 'KeyA',
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        };

        await injectInput(event);

        expect(keyboard.type).toHaveBeenCalledWith('a');
      });

      it('should handle key up event for special keys', async () => {
        const event: KeyboardEvent = {
          type: 'keyboard',
          action: 'up',
          key: 'Enter',
          code: 'Enter',
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        };

        await injectInput(event);

        expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.Enter);
      });

      it('should handle key press event for character keys', async () => {
        const event: KeyboardEvent = {
          type: 'keyboard',
          action: 'press',
          key: 'b',
          code: 'KeyB',
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        };

        await injectInput(event);

        expect(keyboard.type).toHaveBeenCalledWith('b');
      });

      it('should handle keyboard with ctrl modifier', async () => {
        const event: KeyboardEvent = {
          type: 'keyboard',
          action: 'press',
          key: 'c',
          code: 'KeyC',
          modifiers: { ctrl: true, alt: false, shift: false, meta: false },
        };

        await injectInput(event);

        expect(keyboard.pressKey).toHaveBeenCalledWith(Key.LeftControl);
        expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl);
      });

      it('should handle special keys like Escape', async () => {
        const event: KeyboardEvent = {
          type: 'keyboard',
          action: 'press',
          key: 'Escape',
          code: 'Escape',
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        };

        await injectInput(event);

        expect(keyboard.pressKey).toHaveBeenCalledWith(Key.Escape);
        expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.Escape);
      });

      it('should handle arrow keys', async () => {
        const event: KeyboardEvent = {
          type: 'keyboard',
          action: 'press',
          key: 'ArrowUp',
          code: 'ArrowUp',
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        };

        await injectInput(event);

        expect(keyboard.pressKey).toHaveBeenCalledWith(Key.Up);
        expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.Up);
      });
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mouse.setPosition).mockRejectedValueOnce(new Error('Injection failed'));

      const event: MouseMoveEvent = {
        type: 'mouse',
        action: 'move',
        x: 0.5,
        y: 0.5,
      };

      // Should not throw
      await expect(injectInput(event)).resolves.not.toThrow();
    });
  });

  describe('emergencyStop', () => {
    it('should disable injection', async () => {
      enableInjection();
      expect(isInjectionEnabled()).toBe(true);

      await emergencyStop();

      expect(isInjectionEnabled()).toBe(false);
    });

    it('should release modifier keys', async () => {
      await emergencyStop();

      expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftControl);
      expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftAlt);
      expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftShift);
      expect(keyboard.releaseKey).toHaveBeenCalledWith(Key.LeftSuper);
    });

    it('should release mouse buttons', async () => {
      await emergencyStop();

      expect(mouse.releaseButton).toHaveBeenCalledWith(Button.LEFT);
      expect(mouse.releaseButton).toHaveBeenCalledWith(Button.RIGHT);
      expect(mouse.releaseButton).toHaveBeenCalledWith(Button.MIDDLE);
    });

    it('should handle errors during emergency stop', async () => {
      vi.mocked(keyboard.releaseKey).mockRejectedValueOnce(new Error('Release failed'));

      // Should not throw
      await expect(emergencyStop()).resolves.not.toThrow();
    });
  });
});
