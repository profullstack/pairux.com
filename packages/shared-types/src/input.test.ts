import { describe, it, expect } from 'vitest';
import {
  QUALITY_PRESETS,
  modifiersFromDomEvent,
  type MouseEvent,
  type KeyboardEvent,
  type InputMessage,
  type CaptureSource,
  type CaptureSettings,
} from './input';

describe('Input Types', () => {
  describe('MouseEvent', () => {
    it('should create a valid mouse move event', () => {
      const event: MouseEvent = {
        type: 'mouse',
        action: 'move',
        x: 0.5,
        y: 0.5,
      };
      expect(event.action).toBe('move');
      expect(event.x).toBeGreaterThanOrEqual(0);
      expect(event.x).toBeLessThanOrEqual(1);
    });

    it('should create a valid mouse button event', () => {
      const event: MouseEvent = {
        type: 'mouse',
        action: 'click',
        button: 'left',
        x: 0.25,
        y: 0.75,
      };
      expect(event.action).toBe('click');
      expect(event.button).toBe('left');
    });

    it('should create a valid mouse scroll event', () => {
      const event: MouseEvent = {
        type: 'mouse',
        action: 'scroll',
        deltaX: 0,
        deltaY: -120,
        x: 0.5,
        y: 0.5,
      };
      expect(event.action).toBe('scroll');
      expect(event.deltaY).toBe(-120);
    });
  });

  describe('KeyboardEvent', () => {
    it('should create a valid keyboard event', () => {
      const event: KeyboardEvent = {
        type: 'keyboard',
        action: 'down',
        key: 'a',
        code: 'KeyA',
        modifiers: {
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
        },
      };
      expect(event.key).toBe('a');
      expect(event.code).toBe('KeyA');
    });

    it('should handle keyboard modifiers', () => {
      const event: KeyboardEvent = {
        type: 'keyboard',
        action: 'down',
        key: 'c',
        code: 'KeyC',
        modifiers: {
          ctrl: true,
          alt: false,
          shift: false,
          meta: false,
        },
      };
      expect(event.modifiers.ctrl).toBe(true);
    });

    it('should handle special keys', () => {
      const event: KeyboardEvent = {
        type: 'keyboard',
        action: 'press',
        key: 'Enter',
        code: 'Enter',
        modifiers: {
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
        },
      };
      expect(event.key).toBe('Enter');
    });
  });

  describe('InputMessage', () => {
    it('should wrap input events with metadata', () => {
      const message: InputMessage = {
        type: 'input',
        timestamp: Date.now(),
        sequence: 42,
        event: {
          type: 'mouse',
          action: 'click',
          button: 'left',
          x: 0.5,
          y: 0.5,
        },
      };
      expect(message.type).toBe('input');
      expect(message.sequence).toBe(42);
      expect(message.event.type).toBe('mouse');
    });

    it('should support keyboard events', () => {
      const message: InputMessage = {
        type: 'input',
        timestamp: Date.now(),
        sequence: 1,
        event: {
          type: 'keyboard',
          action: 'down',
          key: 'Escape',
          code: 'Escape',
          modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        },
      };
      expect(message.event.type).toBe('keyboard');
    });
  });

  describe('CaptureSource', () => {
    it('should define screen capture source', () => {
      const source: CaptureSource = {
        id: 'screen:0',
        name: 'Main Display',
        type: 'screen',
        displayId: '0',
      };
      expect(source.type).toBe('screen');
    });

    it('should define window capture source', () => {
      const source: CaptureSource = {
        id: 'window:123',
        name: 'VS Code',
        type: 'window',
        thumbnail: 'data:image/png;base64,...',
      };
      expect(source.type).toBe('window');
    });
  });

  describe('CaptureSettings', () => {
    it('should define capture settings', () => {
      const settings: CaptureSettings = {
        resolution: '1080p',
        frameRate: 30,
        includeCursor: true,
        includeAudio: false,
      };
      expect(settings.frameRate).toBe(30);
      expect(settings.includeCursor).toBe(true);
    });
  });

  describe('QUALITY_PRESETS', () => {
    it('should have all quality presets defined', () => {
      expect(QUALITY_PRESETS.low).toBeDefined();
      expect(QUALITY_PRESETS.medium).toBeDefined();
      expect(QUALITY_PRESETS.high).toBeDefined();
      expect(QUALITY_PRESETS.ultra).toBeDefined();
    });

    it('should have increasing bitrates', () => {
      expect(QUALITY_PRESETS.low.bitrate).toBeLessThan(QUALITY_PRESETS.medium.bitrate);
      expect(QUALITY_PRESETS.medium.bitrate).toBeLessThan(QUALITY_PRESETS.high.bitrate);
      expect(QUALITY_PRESETS.high.bitrate).toBeLessThan(QUALITY_PRESETS.ultra.bitrate);
    });

    it('should have valid frame rates', () => {
      Object.values(QUALITY_PRESETS).forEach((preset) => {
        expect(preset.frameRate).toBeGreaterThanOrEqual(15);
        expect(preset.frameRate).toBeLessThanOrEqual(60);
      });
    });

    it('should have valid resolution scaling', () => {
      Object.values(QUALITY_PRESETS).forEach((preset) => {
        expect(preset.resolution).toBeGreaterThan(0);
        expect(preset.resolution).toBeLessThanOrEqual(1);
      });
    });
  });

  // A shortcut has to survive crossing operating systems. "The shortcut key" is
  // Cmd on macOS and Ctrl elsewhere, so sending the literal flag meant a Mac
  // viewer's Cmd+C reached a Linux host as Super+C, and a Linux viewer's Ctrl+C
  // reached a macOS host as Control+C. Neither copies anything.
  describe('modifiersFromDomEvent', () => {
    type DomModifierFlags = Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>;

    const dom = (held: Partial<DomModifierFlags>): DomModifierFlags => ({
      ctrlKey: held.ctrlKey ?? false,
      altKey: held.altKey ?? false,
      shiftKey: held.shiftKey ?? false,
      metaKey: held.metaKey ?? false,
    });

    it('reports a Mac viewer\u2019s Cmd as the accelerator, not as meta', () => {
      expect(modifiersFromDomEvent(dom({ metaKey: true }), 'darwin')).toEqual({
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        accel: true,
      });
    });

    it('reports Ctrl elsewhere as the accelerator, not as ctrl', () => {
      expect(modifiersFromDomEvent(dom({ ctrlKey: true }), 'other')).toEqual({
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        accel: true,
      });
    });

    // On macOS, Control is its own modifier (Control+click is a right click).
    it('keeps macOS Control literal', () => {
      expect(modifiersFromDomEvent(dom({ ctrlKey: true }), 'darwin')).toMatchObject({
        ctrl: true,
        accel: false,
      });
    });

    it('keeps Super literal for non-macOS viewers', () => {
      expect(modifiersFromDomEvent(dom({ metaKey: true }), 'other')).toMatchObject({
        meta: true,
        accel: false,
      });
    });

    it('passes alt and shift straight through', () => {
      expect(modifiersFromDomEvent(dom({ altKey: true, shiftKey: true }), 'other')).toMatchObject({
        alt: true,
        shift: true,
        accel: false,
      });
    });

    it('carries both when macOS Control accompanies Cmd', () => {
      expect(modifiersFromDomEvent(dom({ ctrlKey: true, metaKey: true }), 'darwin')).toMatchObject({
        ctrl: true,
        accel: true,
      });
    });
  });
});
