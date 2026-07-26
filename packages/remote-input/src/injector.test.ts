import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteInputInjector } from './injector.js';
import type { InputBackend, InputEvent, MouseMoveEvent } from './types.js';

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

function makeInjector(backend: InputBackend, maxEventsPerSecond?: number) {
  const options = {
    selection: {
      kind: 'nut-js' as const,
      platform: 'linux' as const,
      displayServer: 'x11' as const,
    },
    createBackend: () => backend,
    logger: silentLogger,
    // These cover gating/rate-limiting/errors, not cursor behaviour; two-cursor
    // mode has its own suite below.
    virtualCursor: false,
    ...(maxEventsPerSecond === undefined ? {} : { maxEventsPerSecond }),
  };
  return new RemoteInputInjector(options);
}

const move: MouseMoveEvent = { type: 'mouse', action: 'move', x: 0.5, y: 0.5 };

describe('RemoteInputInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts disabled and drops events until control is granted', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);

    expect(injector.isEnabled).toBe(false);
    await injector.inject(move);

    expect(backend.inject).not.toHaveBeenCalled();
    expect(injector.getDiagnostics().stats.received).toBe(1);
    expect(injector.getDiagnostics().stats.injected).toBe(0);
  });

  it('injects once enabled', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);

    expect(injector.enable()).toBe(true);
    await injector.inject(move);

    expect(backend.inject).toHaveBeenCalledWith(move);
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
    await injector.inject(move);
    injector.disable();
    await injector.inject(move);

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
    await injector.inject({ type: 'mouse', action: 'move', x: 42, y: 0.5 });

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

    await injector.inject(move);
    await injector.inject(move);
    await injector.inject(move);

    expect(backend.inject).toHaveBeenCalledTimes(2);
    expect(injector.getDiagnostics().stats.rejected).toBe(1);
  });

  it('counts backend failures without throwing', async () => {
    const backend = fakeBackend({ inject: vi.fn().mockRejectedValue(new Error('boom')) });
    const injector = makeInjector(backend);
    injector.enable();

    await expect(injector.inject(move)).resolves.toBeUndefined();
    expect(injector.getDiagnostics().stats.errors).toBe(1);
  });

  it('emergency stop disables injection and releases held keys', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    await injector.emergencyStop();

    expect(backend.emergencyStop).toHaveBeenCalled();
    expect(injector.isEnabled).toBe(false);

    await injector.inject(move);
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
      // A drag: movement keeps arriving, so the button must stay down.
      for (let i = 0; i < 5; i += 1) {
        await vi.advanceTimersByTimeAsync(400);
        await injector.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });
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

// Two cursors on a one-cursor OS: remote movement must never spend the local
// pointer, which is what made control feel like it had been stolen.
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

  /**
   * Two cursors are only used once the backend has confirmed it can report the
   * pointer, so let that probe resolve before asserting.
   */
  async function enableAndSettle(injector: RemoteInputInjector): Promise<void> {
    injector.enable();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
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
    await enableAndSettle(injector);

    await injector.inject({ type: 'mouse', action: 'move', x: 0.1, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'move', x: 0.3, y: 0.4 });

    expect(backend.inject).not.toHaveBeenCalled();
    expect(injector.getRemoteCursorPosition()).toEqual({ x: 0.3, y: 0.4 });
  });

  it('borrows the pointer for a click and hands it straight back', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    await enableAndSettle(injector);

    await injector.inject({ type: 'mouse', action: 'move', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.2, y: 0.2 });

    // Last movement returns the local pointer to where its owner left it.
    const restore = moves(backend).at(-1);
    expect(restore?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });

  // Restoring between down and up would tear the drag apart.
  it('keeps the pointer in place for the whole of a drag', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    await enableAndSettle(injector);

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });

    expect(moves(backend)).toHaveLength(0);

    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.5, y: 0.5 });
    expect(moves(backend).at(-1)?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });

  // Wayland gives clients no way to read the pointer. Two cursors then rest on
  // a single absolute positioning call per click with nothing to correct it, so
  // movement is driven directly instead: a click that lands beats a cursor that
  // stayed put.
  it('drives the cursor directly when the platform will not report the pointer', async () => {
    const backend = fakeBackend();
    delete (backend as { getCursorPosition?: unknown }).getCursorPosition;
    const injector = twoCursorInjector(backend);
    await enableAndSettle(injector);

    await injector.inject({ type: 'mouse', action: 'move', x: 0.3, y: 0.4 });
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });

    expect(backend.inject).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'move', x: 0.3, y: 0.4 })
    );
    expect(backend.inject).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'down', button: 'left' })
    );
  });

  it('drives the system cursor directly when two-cursor mode is off', async () => {
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
    await enableAndSettle(injector);

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.releaseAll('viewer disconnected');

    expect(moves(backend).at(-1)?.[0]).toMatchObject({ x: 0.9, y: 0.9 });
  });
});
