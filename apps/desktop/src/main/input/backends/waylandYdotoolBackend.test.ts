import { describe, expect, it, vi } from 'vitest';
import type { InputEvent } from '@pairux/shared-types';
import { WaylandYdotoolInputBackend } from './waylandYdotoolBackend';

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
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['click', '--repeat', '2', '196']);
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
