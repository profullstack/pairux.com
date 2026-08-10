import { describe, expect, it, vi } from 'vitest';
import type { InputEvent } from '../types.js';
import { WaylandYdotoolInputBackend } from './waylandYdotool.js';

describe('WaylandYdotoolInputBackend', () => {
  it('reports unsupported when ydotool is unavailable', async () => {
    const backend = new WaylandYdotoolInputBackend(vi.fn(), {
      hasBinary: false,
      hasSocket: false,
      socketPath: null,
    });
    expect(backend.supported).toBe(false);
    await expect(backend.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 })).rejects.toThrow(
      /ydotool/i
    );
  });

  it('attempts to auto-start ydotoold during init when binary exists but socket is missing', async () => {
    const startDaemon = vi.fn().mockResolvedValue({
      attempted: true,
      method: 'systemctl --user start ydotool',
    });
    const probeAvailability = vi
      .fn()
      .mockReturnValueOnce({ hasBinary: true, hasSocket: false, socketPath: null })
      .mockReturnValue({ hasBinary: true, hasSocket: true, socketPath: '/run/ydotoold/socket' });
    const backend = new WaylandYdotoolInputBackend(
      vi.fn(),
      { hasBinary: true, hasSocket: false, socketPath: null },
      {
        startDaemon,
        probeAvailability,
        sleep: vi.fn().mockResolvedValue(undefined),
        // No compositor here: keep the default and stay out of child_process.
        detectScreenSize: vi.fn().mockResolvedValue(null),
      }
    );

    expect(backend.supported).toBe(false);

    const initResult = await backend.init();

    expect(startDaemon).toHaveBeenCalledTimes(1);
    expect(backend.supported).toBe(true);
    expect(initResult).toEqual({ screenWidth: 1920, screenHeight: 1080 });
    expect(backend.details).toMatchObject({
      hasYdotoolBinary: true,
      hasYdotoolSocket: true,
      ydotoolSocketPath: '/run/ydotoold/socket',
      autoStartAttempted: true,
    });
  });

  // The 1920×1080 default puts every click roughly half way to its target on a
  // 4K display, so a detected size must actually be adopted.
  it('adopts a detected screen size for coordinate mapping', async () => {
    const backend = new WaylandYdotoolInputBackend(
      vi.fn(),
      { hasBinary: true, hasSocket: true, socketPath: '/run/ydotoold/socket' },
      { detectScreenSize: vi.fn().mockResolvedValue({ width: 3840, height: 2160 }) }
    );

    await expect(backend.init()).resolves.toEqual({ screenWidth: 3840, screenHeight: 2160 });
  });

  it('keeps the default when detection fails', async () => {
    const backend = new WaylandYdotoolInputBackend(
      vi.fn(),
      { hasBinary: true, hasSocket: true, socketPath: '/run/ydotoold/socket' },
      { detectScreenSize: vi.fn().mockRejectedValue(new Error('no compositor tools')) }
    );

    await expect(backend.init()).resolves.toEqual({ screenWidth: 1920, screenHeight: 1080 });
  });

  it('emits mouse move command with absolute coordinates', async () => {
    const run = vi.fn(async (_command: string, _args: string[]) => undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });
    backend.updateScreenSize(1920, 1080);

    const event: InputEvent = { type: 'mouse', action: 'move', x: 0.5, y: 0.5 };
    await backend.inject(event);

    expect(run).toHaveBeenCalledWith('ydotool', ['mousemove', '--absolute', '960', '540']);
  });

  it('emits mouse click sequence (move + click)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });
    backend.updateScreenSize(1000, 1000);

    const event: InputEvent = { type: 'mouse', action: 'click', button: 'left', x: 0.2, y: 0.3 };
    await backend.inject(event);

    expect(run).toHaveBeenNthCalledWith(1, 'ydotool', ['mousemove', '--absolute', '200', '300']);
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['click', '192']);
  });

  it('emits simple character typing for unmodified press', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    const event: InputEvent = {
      type: 'keyboard',
      action: 'press',
      key: 'a',
      code: 'KeyA',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
    };
    await backend.inject(event);

    expect(run).toHaveBeenCalledWith('ydotool', ['type', 'a']);
  });

  it('uses the detected ydotool binary for text input', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      binaryPath: '/opt/pairux/ydotool',
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    await backend.inject({
      type: 'keyboard',
      action: 'press',
      key: 'a',
      code: 'KeyA',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
    });
    await backend.inject({
      type: 'keyboard',
      action: 'press',
      key: '🙂',
      code: 'Unidentified',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
    });

    expect(run).toHaveBeenNthCalledWith(1, '/opt/pairux/ydotool', ['type', 'a']);
    expect(run).toHaveBeenNthCalledWith(2, '/opt/pairux/ydotool', ['type', '🙂']);
  });

  it('emits key sequence for modified shortcut', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    const event: InputEvent = {
      type: 'keyboard',
      action: 'press',
      key: 'c',
      code: 'KeyC',
      modifiers: { ctrl: true, alt: false, shift: false, meta: false },
    };
    await backend.inject(event);

    expect(run).toHaveBeenCalledWith('ydotool', ['key', '29:1', '46:1', '46:0', '29:0']);
  });

  it('emits vertical scroll via wheel click codes', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });
    backend.updateScreenSize(1000, 1000);

    const event: InputEvent = {
      type: 'mouse',
      action: 'scroll',
      deltaX: 0,
      deltaY: -240,
      x: 0.4,
      y: 0.6,
    };
    await backend.inject(event);

    expect(run).toHaveBeenNthCalledWith(1, 'ydotool', ['mousemove', '--absolute', '400', '600']);
    // Negative deltaY is a scroll *up* => button 4, base 0x03 => 0xC3 = 195.
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['click', '--repeat', '2', '195']);
  });

  // Regression: both backends treated positive deltaY as "up", so every remote
  // scroll went the wrong way. DOM deltaY is positive when scrolling down.
  it('scrolls down for positive deltaY', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });
    backend.updateScreenSize(1000, 1000);

    await backend.inject({
      type: 'mouse',
      action: 'scroll',
      deltaX: 0,
      deltaY: 120,
      x: 0.4,
      y: 0.6,
    });

    // button 5 (down), base 0x04 => 0xC4 = 196.
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['click', '196']);
  });

  it('emits horizontal scroll via wheel click codes', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });
    backend.updateScreenSize(1000, 1000);

    const event: InputEvent = {
      type: 'mouse',
      action: 'scroll',
      deltaX: 120,
      deltaY: 0,
      x: 0.4,
      y: 0.6,
    };
    await backend.inject(event);

    expect(run).toHaveBeenNthCalledWith(1, 'ydotool', ['mousemove', '--absolute', '400', '600']);
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['click', '198']);
  });
});
