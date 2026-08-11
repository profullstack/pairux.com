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

    // Modifiers move in their own invocation now: they are held across whole
    // chords rather than re-pressed around each key, so the delta is emitted
    // when it changes and the key event carries only the key.
    expect(run).toHaveBeenNthCalledWith(1, 'ydotool', ['key', '29:1']);
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['key', '46:1', '46:0']);
    expect(run).toHaveBeenNthCalledWith(3, 'ydotool', ['key', '29:0']);
  });

  // The bug this whole layer exists for. A Mac guest's Cmd is `MetaLeft`, and
  // injected literally on KDE it holds Super — where Super+click is a
  // window-manager gesture, so every click stops reaching the application and
  // the guest sees a cursor that moves over a desktop that ignores them.
  it("presses Control for a Mac guest's Cmd, not Super", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    await backend.inject({
      type: 'keyboard',
      action: 'down',
      key: 'Meta',
      code: 'MetaLeft',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false, accel: true },
    });

    // 29 is ControlLeft, 125 is MetaLeft. Super must not appear at all.
    expect(run).toHaveBeenCalledWith('ydotool', ['key', '29:1']);
    expect(run).not.toHaveBeenCalledWith('ydotool', ['key', '125:1']);
  });

  // Right-Cmd took a different path and stayed broken after the left one was
  // fixed: `ControlRight` had no keycode in the table, so the lookup fell
  // through to the `Meta` name alias and pressed Super after all. `MetaRight`
  // is the key the original stuck-input report actually named.
  it("presses right Control for a Mac guest's right Cmd", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    await backend.inject({
      type: 'keyboard',
      action: 'down',
      key: 'Meta',
      code: 'MetaRight',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false, accel: true },
    });

    expect(run).toHaveBeenCalledWith('ydotool', ['key', '29:1']);
    expect(run).not.toHaveBeenCalledWith('ydotool', ['key', '126:1']);
  });

  // A guest who lets go of Cmd while the release is lost would otherwise leave
  // Super held. Every event restates the full modifier set, so the next one
  // puts it right without needing the release that went missing.
  it('releases a modifier whose key-up never arrived', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    const accel = { ctrl: false, alt: false, shift: false, meta: false, accel: true };
    const none = { ctrl: false, alt: false, shift: false, meta: false };

    await backend.inject({
      type: 'keyboard',
      action: 'down',
      key: 'Meta',
      code: 'MetaLeft',
      modifiers: accel,
    });
    run.mockClear();

    // No key-up for Meta — just an unrelated keystroke that happens to say the
    // accelerator is no longer held.
    await backend.inject({
      type: 'keyboard',
      action: 'down',
      key: 'a',
      code: 'KeyA',
      modifiers: none,
    });

    expect(run).toHaveBeenCalledWith('ydotool', ['key', '29:0']);
  });

  // A trackpad reports the pixels your fingers moved, not notches. Rounding
  // each 3px event up to a whole notch turned a gentle two-finger drag into a
  // burst of hard wheel clicks — the "scrolling is insanely fast" report.
  it('does not fire a wheel notch for every pixel of a trackpad drag', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const backend = new WaylandYdotoolInputBackend(run, {
      hasBinary: true,
      hasSocket: true,
      socketPath: '/tmp/.ydotool_socket',
    });

    for (let i = 0; i < 10; i += 1) {
      await backend.inject({
        type: 'mouse',
        action: 'scroll',
        deltaX: 0,
        deltaY: 3,
        deltaMode: 0,
        x: 0.5,
        y: 0.5,
      });
    }

    // 30px of movement is under a third of a notch, so nothing should scroll.
    const clicks = run.mock.calls.filter(([, args]) => args[0] === 'click');
    expect(clicks).toHaveLength(0);
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
