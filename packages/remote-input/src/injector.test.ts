import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteInputInjector } from './injector.js';
import type { InputBackend, InputEvent, MouseButtonEvent } from './types.js';

function fakeBackend(overrides: Partial<InputBackend> = {}): InputBackend {
  return {
    name: 'fake',
    supported: true,
    init: vi.fn().mockResolvedValue({ screenWidth: 1920, screenHeight: 1080 }),
    updateScreenSize: vi.fn(),
    inject: vi.fn().mockResolvedValue(undefined),
    emergencyStop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeInjector(backend: InputBackend, maxEventsPerSecond?: number): RemoteInputInjector {
  const options = {
    selection: {
      kind: 'nut-js' as const,
      platform: 'linux' as const,
      displayServer: 'x11' as const,
    },
    createBackend: () => backend,
    logger: silentLogger,
    // virtualCursor off by default for these non-cursor tests
    virtualCursor: false,
    ...(maxEventsPerSecond === undefined ? {} : { maxEventsPerSecond }),
  };
  return new RemoteInputInjector(options);
}

const click: MouseButtonEvent = { type: 'mouse', action: 'down', button: 'left', x: 0.5, y: 0.5 };

describe('RemoteInputInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts disabled and drops events until control is granted', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);

    expect(injector.isEnabled).toBe(false);
    await injector.inject(click);

    expect(backend.inject).not.toHaveBeenCalled();
    expect(injector.getDiagnostics().stats.received).toBe(1);
    expect(injector.getDiagnostics().stats.injected).toBe(0);
  });

  it('injects once enabled', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);

    expect(injector.enable()).toBe(true);
    await injector.inject(click);

    expect(backend.inject).toHaveBeenCalledWith(click);
    expect(injector.getDiagnostics().stats.injected).toBe(1);
  });

  // A host that "granted" control on a machine that cannot inject would show a
  // working session that silently does nothing, so enable() must fail loudly.
  it('refuses to enable when the backend is unsupported', () => {
    const backend = fakeBackend({ supported: false, reason: 'no ydotoold' });
    const injector = makeInjector(backend);

    expect(injector.enable()).toBe(false);
    expect(injector.isEnabled).toBe(false);
    expect(injector.getDiagnostics().reason).toBe('no ydotoold');
  });

  it('stops injecting after disable', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);

    injector.enable();
    // Use a 'click' action (press+release atom) so nothing is held when
    // disable fires — otherwise releaseAll() would inject an 'up' too.
    await injector.inject({ type: 'mouse', action: 'click', button: 'left', x: 0.5, y: 0.5 });
    injector.disable();
    await injector.inject(click);

    // Only the pre-disable click should have reached the backend.
    expect(backend.inject).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid events without reaching the OS', async () => {
    const backend = fakeBackend();
    const onRejected = vi.fn();
    const injector = new RemoteInputInjector({
      selection: { kind: 'nut-js', platform: 'linux', displayServer: 'x11' },
      createBackend: () => backend,
      logger: silentLogger,
      virtualCursor: false,
      onRejected,
    });

    injector.enable();
    // x=42 is out of normalized 0-1 range
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 42, y: 0.5 });

    expect(backend.inject).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(
      'invalid-coordinates',
      expect.anything(),
      expect.any(String)
    );
    expect(injector.getDiagnostics().stats.rejected).toBe(1);
  });

  it('blocks dangerous key combinations', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    const event: InputEvent = {
      type: 'keyboard',
      action: 'press',
      key: 'Delete',
      code: 'Delete',
      modifiers: { ctrl: true, alt: true, shift: false, meta: false },
    };
    await injector.inject(event);

    expect(backend.inject).not.toHaveBeenCalled();
  });

  it('enforces the rate ceiling', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend, 2);
    injector.enable();

    await injector.inject(click);
    await injector.inject(click);
    await injector.inject(click);

    expect(backend.inject).toHaveBeenCalledTimes(2);
    expect(injector.getDiagnostics().stats.rejected).toBe(1);
  });

  it('counts backend failures without throwing', async () => {
    const backend = fakeBackend({ inject: vi.fn().mockRejectedValue(new Error('boom')) });
    const injector = makeInjector(backend);
    injector.enable();

    await expect(injector.inject(click)).resolves.toBeUndefined();
    expect(injector.getDiagnostics().stats.errors).toBe(1);
  });

  it('emergency stop disables injection and releases held keys', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    await injector.emergencyStop();

    expect(backend.emergencyStop).toHaveBeenCalled();
    expect(injector.isEnabled).toBe(false);

    await injector.inject(click);
    expect(backend.inject).not.toHaveBeenCalled();
  });

  it('survives an emergency stop that itself fails', async () => {
    const backend = fakeBackend({
      emergencyStop: vi.fn().mockRejectedValue(new Error('nope')),
    });
    const injector = makeInjector(backend);
    injector.enable();

    await expect(injector.emergencyStop()).resolves.toBeUndefined();
    expect(injector.isEnabled).toBe(false);
  });

  it('forwards screen size to the backend', () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);

    injector.updateScreenSize(2560, 1440);
    expect(backend.updateScreenSize).toHaveBeenCalledWith(2560, 1440);
  });

  it('tolerates a backend whose init throws', async () => {
    const backend = fakeBackend({ init: vi.fn().mockRejectedValue(new Error('no display')) });
    const injector = makeInjector(backend);

    await expect(injector.init()).resolves.toBeUndefined();
  });

  it('reports diagnostics for the selected backend', () => {
    const backend = fakeBackend({ name: 'wayland-ydotool', details: { hasSocket: true } });
    const injector = makeInjector(backend);

    const diagnostics = injector.getDiagnostics();
    expect(diagnostics.backend).toBe('wayland-ydotool');
    expect(diagnostics.backendSupported).toBe(true);
    expect(diagnostics.details).toEqual({ hasSocket: true });
  });
});

// A button injected "down" whose "up" never arrives leaves the host desktop in
// a permanent drag: every click is swallowed and the machine looks frozen to
// its own user. Recovering used to need a reboot, so releasing held input is
// the single most important safety property of this class.
describe('RemoteInputInjector held-input safety', () => {
  const down = (button: 'left' | 'right' | 'middle' = 'left'): InputEvent => ({
    type: 'mouse',
    action: 'down',
    button,
    x: 0.5,
    y: 0.5,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases a held button when injection is disabled', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    await injector.inject(down());
    injector.disable();
    await injector.releaseAll('test');

    expect(backend.inject).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouse', action: 'up', button: 'left' })
    );
  });

  it('releases a held key when injection is disabled', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    await injector.inject({
      type: 'keyboard',
      action: 'down',
      key: 'a',
      code: 'KeyA',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
    });
    await injector.releaseAll('test');

    expect(backend.inject).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyboard', action: 'up', code: 'KeyA' })
    );
  });

  it('does not re-release a button that was already lifted', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    await injector.inject(down());
    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.5, y: 0.5 });

    const upsBefore = vi
      .mocked(backend.inject)
      .mock.calls.filter(([e]) => 'action' in e && e.action === 'up').length;

    await injector.releaseAll('test');

    const upsAfter = vi
      .mocked(backend.inject)
      .mock.calls.filter(([e]) => 'action' in e && e.action === 'up').length;
    expect(upsAfter).toBe(upsBefore);
  });

  // The viewer's connection can die mid-drag, in which case no "up" is ever
  // sent and only the host can break the deadlock.
  it('force-releases a button held with no further input', async () => {
    vi.useFakeTimers();
    try {
      const backend = fakeBackend();
      const injector = new RemoteInputInjector({
        selection: { kind: 'nut-js', platform: 'linux', displayServer: 'x11' },
        createBackend: () => backend,
        logger: silentLogger,
        virtualCursor: false,
        holdTimeoutMs: 1000,
      });
      injector.enable();

      await injector.inject(down());
      await vi.advanceTimersByTimeAsync(1500);

      expect(backend.inject).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mouse', action: 'up', button: 'left' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps holding while input continues to arrive', async () => {
    vi.useFakeTimers();
    try {
      const backend = fakeBackend();
      const injector = new RemoteInputInjector({
        selection: { kind: 'nut-js', platform: 'linux', displayServer: 'x11' },
        createBackend: () => backend,
        logger: silentLogger,
        virtualCursor: false,
        holdTimeoutMs: 1000,
      });
      injector.enable();

      await injector.inject(down());
      // A drag: clicks keep arriving, so the button must stay down.
      for (let i = 0; i < 5; i += 1) {
        await vi.advanceTimersByTimeAsync(400);
        await injector.inject(down());
      }

      const ups = vi
        .mocked(backend.inject)
        .mock.calls.filter(([e]) => 'action' in e && e.action === 'up');
      expect(ups).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Remote mouse movement must never spend the local pointer — that is what
// made control feel like it had been stolen. Moves are tracked rather than
// injected; clicks briefly borrow the pointer and hand it back. The one
// exception is a drag, where the single real cursor has to follow the motion.
describe('RemoteInputInjector two-cursor mode', () => {
  const moves = (backend: InputBackend) =>
    vi.mocked(backend.inject).mock.calls.filter(([e]) => 'action' in e && e.action === 'move');

  function twoCursorInjector(backend: InputBackend) {
    return new RemoteInputInjector({
      selection: { kind: 'nut-js', platform: 'darwin', displayServer: 'macos' },
      createBackend: () => backend,
      logger: silentLogger,
    });
  }

  /** A host that can report its pointer, i.e. macOS/Windows/X11. */
  function reportingBackend(overrides: Partial<InputBackend> = {}): InputBackend {
    return fakeBackend({
      getCursorPosition: vi.fn().mockResolvedValue({ x: 0.9, y: 0.9 }),
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not move the local pointer for remote movement', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'move', x: 0.1, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'move', x: 0.3, y: 0.4 });

    expect(backend.inject).not.toHaveBeenCalled();
    expect(injector.getRemoteCursorPosition()).toEqual({ x: 0.3, y: 0.4 });
  });

  it('borrows the pointer for a click and hands it straight back', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'move', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.2, y: 0.2 });

    // Last movement returns the local pointer to where its owner left it.
    const restore = moves(backend).at(-1);
    expect(restore?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });

  // Restoring between down and up would tear the drag apart, so the borrowed
  // pointer is only handed back once every button is released.
  it('holds the borrowed pointer until the drag ends', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });

    // No restore yet — the only move so far is the drag motion itself.
    expect(moves(backend).map(([e]) => e)).toEqual([expect.objectContaining({ x: 0.5, y: 0.5 })]);

    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.5, y: 0.5 });
    expect(moves(backend).at(-1)?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });

  // A drag that only sends down-then-up is not a drag: text selection, canvas
  // apps, HTML5 drag-and-drop and file managers all need the motion between.
  it('injects motion while a button is held so drags do not tear', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    // Before the press: virtual, nothing reaches the OS.
    await injector.inject({ type: 'mouse', action: 'move', x: 0.1, y: 0.1 });
    expect(moves(backend)).toHaveLength(0);

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });

    // During the press: every move reaches the OS, in order.
    await injector.inject({ type: 'mouse', action: 'move', x: 0.4, y: 0.4 });
    await injector.inject({ type: 'mouse', action: 'move', x: 0.6, y: 0.6 });

    expect(moves(backend).map(([e]) => e)).toEqual([
      expect.objectContaining({ x: 0.4, y: 0.4 }),
      expect.objectContaining({ x: 0.6, y: 0.6 }),
    ]);

    // After release: virtual again (past the pointer restore).
    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.6, y: 0.6 });
    vi.mocked(backend.inject).mockClear();
    await injector.inject({ type: 'mouse', action: 'move', x: 0.8, y: 0.8 });
    expect(moves(backend)).toHaveLength(0);
  });

  // Wayland gives clients no way to read the pointer.  Clicks still land at
  // the right position — the pointer briefly jumps there — but remote moves
  // never drive the host cursor, so the host keeps an independent pointer
  // and compositor hot-corners never fire from remote input.
  it('virtualizes moves and injects clicks even without pointer reporting', async () => {
    const backend = fakeBackend();
    delete (backend as { getCursorPosition?: unknown }).getCursorPosition;
    const injector = twoCursorInjector(backend);
    injector.enable();

    // Move — must NOT reach the OS.
    await injector.inject({ type: 'mouse', action: 'move', x: 0.3, y: 0.4 });
    expect(backend.inject).not.toHaveBeenCalled();

    // Click — must reach the OS.
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    expect(backend.inject).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'down', button: 'left' })
    );
  });

  it('drives the system cursor directly when virtualCursor is off', async () => {
    const backend = fakeBackend();
    const injector = new RemoteInputInjector({
      selection: { kind: 'nut-js', platform: 'darwin', displayServer: 'macos' },
      createBackend: () => backend,
      logger: silentLogger,
      virtualCursor: false,
    });
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'move', x: 0.3, y: 0.4 });

    expect(backend.inject).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'move', x: 0.3, y: 0.4 })
    );
  });

  it('hands the pointer back when stuck input is released', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.releaseAll('viewer disconnected');

    expect(moves(backend).at(-1)?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });

  it('hands the pointer back after a scroll, which borrows it too', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({
      type: 'mouse',
      action: 'scroll',
      deltaX: 0,
      deltaY: -100,
      x: 0.3,
      y: 0.3,
    });

    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ action: 'scroll' }));
    expect(moves(backend).at(-1)?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });
});

// Compositor hot-corners (GNOME's Activities corner) fire from the corner
// pixel, so a guest brushing it hijacks the host's desktop. Hosts that need it
// opt in to a pixel inset; everyone else gets the guest's exact coordinates,
// because an inset costs real clickable area at the screen edge.
describe('RemoteInputInjector edge margin', () => {
  function marginInjector(backend: InputBackend, edgeMarginPx: number): RemoteInputInjector {
    return new RemoteInputInjector({
      selection: { kind: 'nut-js', platform: 'linux', displayServer: 'wayland' },
      createBackend: () => backend,
      logger: silentLogger,
      edgeMarginPx,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves coordinates untouched by default', async () => {
    const backend = fakeBackend();
    const injector = marginInjector(backend, 0);
    injector.updateScreenSize(1000, 500);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0, y: 1 });

    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 1 }));
  });

  it('insets corner clicks by the configured pixel margin', async () => {
    const backend = fakeBackend();
    const injector = marginInjector(backend, 1);
    injector.updateScreenSize(1000, 500);
    injector.enable();

    // 1px of 1000 wide = 0.001; 1px of 500 tall = 0.002.
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0, y: 0 });
    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ x: 0.001, y: 0.002 }));

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 1, y: 1 });
    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ x: 0.999, y: 0.998 }));
  });

  it('leaves interior clicks exactly where the guest put them', async () => {
    const backend = fakeBackend();
    const injector = marginInjector(backend, 1);
    injector.updateScreenSize(1000, 500);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.5, y: 0.5 });

    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ x: 0.5, y: 0.5 }));
  });

  it('cannot inset when the screen size is still unknown', async () => {
    const backend = fakeBackend();
    const injector = marginInjector(backend, 1);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0, y: 0 });

    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0 }));
  });

  it('ignores a margin wider than half the screen rather than inverting it', async () => {
    const backend = fakeBackend();
    const injector = marginInjector(backend, 400);
    injector.updateScreenSize(100, 100);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0, y: 0 });

    expect(backend.inject).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 0 }));
  });
});
