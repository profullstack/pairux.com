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
// A button left down at the OS level survives the process that pressed it. The
// host is then unable to click anything and has to reboot, so letting go can
// never depend on this injector's bookkeeping being correct.
describe('RemoteInputInjector unconditional release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases at the OS level on dispose, even with nothing tracked', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    await injector.dispose();

    expect(backend.emergencyStop).toHaveBeenCalled();
  });

  it('releases at the OS level on disable, even with nothing tracked', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    injector.disable();
    // disable() is sync and finishes the release in the background.
    await vi.waitFor(() => {
      expect(backend.emergencyStop).toHaveBeenCalled();
    });
  });

  // The press that escapes tracking is the one that strands the host, so the
  // release must not be skipped just because heldButtons looks empty.
  it('still releases when a press was never tracked', async () => {
    const backend = fakeBackend();
    const injector = makeInjector(backend);
    injector.enable();

    // A press the injector does not know about, exactly as a mid-flight
    // dispatch would leave it: it went straight to the backend, so
    // trackHeldState never saw it and releaseAll has nothing to let go of.
    await backend.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.5, y: 0.5 });

    await injector.dispose();

    expect(backend.emergencyStop).toHaveBeenCalled();
  });

  it('waits for an in-flight injection before releasing on dispose', async () => {
    let releaseDispatch: (() => void) | undefined;
    let firstCallBlocked = false;
    const backend = fakeBackend({
      // Only the press hangs. The releases that follow must resolve, or the
      // test deadlocks on the very cleanup it is trying to observe.
      inject: vi.fn().mockImplementation(() => {
        if (firstCallBlocked) return Promise.resolve();
        firstCallBlocked = true;
        return new Promise<void>((resolve) => {
          releaseDispatch = resolve;
        });
      }),
    });
    const injector = makeInjector(backend);
    injector.enable();

    const inFlight = injector.inject({
      type: 'mouse',
      action: 'down',
      button: 'left',
      x: 0.5,
      y: 0.5,
    });

    // Let dispatch get as far as the backend, so the press is genuinely
    // in-flight before dispose() is asked to clean up.
    await vi.waitFor(() => {
      expect(backend.inject).toHaveBeenCalled();
    });

    const disposed = injector.dispose();

    // Nothing may be released while the press is still being dispatched —
    // that is exactly the window where trackHeldState has not run yet, and
    // releasing there would leave the button down for good.
    expect(backend.emergencyStop).not.toHaveBeenCalled();

    releaseDispatch?.();
    await inFlight;
    await disposed;

    expect(backend.emergencyStop).toHaveBeenCalled();
  });
});

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

  // The failure that took a host's machine away from them.
  //
  // A lost "up" leaves the button held. The guest carries on moving the mouse,
  // every move resets the idle watchdog, and it never fires. A held button
  // makes dispatch treat movement as a drag and inject it, so the guest's
  // pointer starts driving the host's and the host cannot use their own
  // machine until control is revoked. The absolute timer is the only thing
  // that ends this, so it must not be resettable by incoming movement.
  it('releases a hold whose "up" was lost even while moves keep arriving', async () => {
    vi.useFakeTimers();
    try {
      const backend = fakeBackend();
      const injector = new RemoteInputInjector({
        selection: { kind: 'nut-js', platform: 'linux', displayServer: 'x11' },
        createBackend: () => backend,
        logger: silentLogger,
        virtualCursor: false,
        holdTimeoutMs: 1000,
        maxHoldMs: 5000,
      });
      injector.enable();

      await injector.inject(down());

      // Movement never stops, so the idle timer is reset over and over and
      // would on its own keep the button held indefinitely.
      for (let i = 0; i < 20; i += 1) {
        await vi.advanceTimersByTimeAsync(400);
        await injector.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });
      }

      const ups = vi
        .mocked(backend.inject)
        .mock.calls.filter(([e]) => 'action' in e && e.action === 'up');
      expect(ups.length).toBeGreaterThan(0);
      expect(injector.getDiagnostics().heldButtons).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // The absolute timer must not turn into a guillotine for real drags either:
  // it starts once per hold and is not restarted by each new press.
  it('does not restart the absolute timer on every press', async () => {
    vi.useFakeTimers();
    try {
      const backend = fakeBackend();
      const injector = new RemoteInputInjector({
        selection: { kind: 'nut-js', platform: 'linux', displayServer: 'x11' },
        createBackend: () => backend,
        logger: silentLogger,
        virtualCursor: false,
        holdTimeoutMs: 1000,
        maxHoldMs: 5000,
      });
      injector.enable();

      await injector.inject(down());
      for (let i = 0; i < 10; i += 1) {
        await vi.advanceTimersByTimeAsync(400);
        await injector.inject(down());
      }

      // 4s of presses is inside both windows, so nothing has been released.
      expect(injector.getDiagnostics().heldButtons).toBe(1);

      await vi.advanceTimersByTimeAsync(2000);
      expect(injector.getDiagnostics().heldButtons).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // A clean press/release must leave nothing armed, or the next hold inherits
  // a timer that is already partway through its window.
  it('clears the absolute timer when a button is released normally', async () => {
    vi.useFakeTimers();
    try {
      const backend = fakeBackend();
      const injector = new RemoteInputInjector({
        selection: { kind: 'nut-js', platform: 'linux', displayServer: 'x11' },
        createBackend: () => backend,
        logger: silentLogger,
        virtualCursor: false,
        holdTimeoutMs: 1000,
        maxHoldMs: 5000,
      });
      injector.enable();

      await injector.inject(down());
      await vi.advanceTimersByTimeAsync(4000);
      await injector.inject({
        type: 'mouse',
        action: 'up',
        button: 'left',
        x: 0.5,
        y: 0.5,
      });
      vi.mocked(backend.inject).mockClear();

      // A fresh hold, kept alive so only the absolute timer is under test.
      // It gets a full 5s window; had it inherited the previous hold's timer
      // there would be 1s left and the button would be released during this.
      await injector.inject(down());
      for (let i = 0; i < 10; i += 1) {
        await vi.advanceTimersByTimeAsync(400);
        await injector.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });
      }

      const ups = vi
        .mocked(backend.inject)
        .mock.calls.filter(([e]) => 'action' in e && e.action === 'up');
      expect(ups).toHaveLength(0);
      expect(injector.getDiagnostics().heldButtons).toBe(1);
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

  it('keeps movement virtual when the host cannot report the pointer', async () => {
    const backend = fakeBackend();
    delete (backend as { getCursorPosition?: unknown }).getCursorPosition;
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'move', x: 0.3, y: 0.4 });

    expect(moves(backend)).toHaveLength(0);
  });

  // The method can exist and still refuse to answer (KWin not reporting). A
  // click then cannot be restored, but remote movement must remain virtual.
  it('does not hijack movement once a position read comes back empty', async () => {
    const backend = fakeBackend({ getCursorPosition: vi.fn().mockResolvedValue(null) });
    const injector = twoCursorInjector(backend);
    injector.enable();

    // Before anything is known, movement stays virtual.
    await injector.inject({ type: 'mouse', action: 'move', x: 0.1, y: 0.1 });
    expect(moves(backend)).toHaveLength(0);

    // A click reveals the pointer cannot be read.
    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.2, y: 0.2 });

    // From here a later click cannot restore the local pointer, but movement
    // must not continuously warp it away from the host.
    await injector.inject({ type: 'mouse', action: 'move', x: 0.7, y: 0.8 });
    expect(moves(backend)).toHaveLength(0);
  });

  // A host that *can* report the pointer must keep both cursors, or the fix
  // above would quietly take two-cursor mode away from everyone.
  it('keeps the cursors apart when the host can report the pointer', async () => {
    const backend = reportingBackend();
    const injector = twoCursorInjector(backend);
    injector.enable();

    await injector.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.2, y: 0.2 });
    await injector.inject({ type: 'mouse', action: 'up', button: 'left', x: 0.2, y: 0.2 });
    vi.mocked(backend.inject).mockClear();

    await injector.inject({ type: 'mouse', action: 'move', x: 0.7, y: 0.8 });

    expect(moves(backend)).toHaveLength(0);
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

/**
 * Why the host felt laggy and unclickable.
 *
 * Every injection is serialized, and on Wayland each one costs a ydotool
 * process spawn. A viewer streams pointer movement at their display's refresh
 * rate, which arrives faster than that drains, so the queue grew without bound:
 * the host's pointer trailed further and further behind and a click sat behind
 * hundreds of stale positions before it was even attempted.
 */
describe('move coalescing', () => {
  /** A backend whose injections only finish when the test says so. */
  function blockingBackend(): {
    backend: InputBackend;
    release: () => void;
    injected: InputEvent[];
  } {
    const injected: InputEvent[] = [];
    let pending: (() => void)[] = [];

    const backend = fakeBackend({
      inject: vi.fn((event: InputEvent) => {
        injected.push(event);
        return new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      }),
    });

    return {
      backend,
      release: () => {
        const waiting = pending;
        pending = [];
        for (const resolve of waiting) resolve();
      },
      injected,
    };
  }

  function move(x: number): InputEvent {
    return { type: 'mouse', action: 'move', x, y: 0.5 };
  }

  /**
   * Let a blocked queue finish. Each release frees whatever is in flight, and
   * the next entry needs a turn of the event loop to reach the backend, so this
   * alternates until everything settles rather than guessing at a count.
   */
  async function drain(release: () => void, promises: Promise<unknown>[]): Promise<void> {
    // Releasing an already-empty queue is a no-op, so this just runs enough
    // rounds to outlast any queue these tests build rather than tracking when
    // to stop.
    for (let i = 0; i < 20; i += 1) {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await Promise.all(promises);
  }

  it('keeps the newest superseding move when the queue drains', async () => {
    const { backend, release, injected } = blockingBackend();
    const injector = makeInjector(backend);
    injector.enable();

    // One injection in flight, then a burst behind it.
    const inFlight = injector.inject(move(0.1));
    await Promise.resolve();
    const queued = [injector.inject(move(0.2)), injector.inject(move(0.3))];

    await drain(release, [inFlight, ...queued]);

    // The middle position is gone, but the final position is injected rather
    // than silently lost with it.
    const xs = injected.filter((e) => 'x' in e).map((e) => (e as { x: number }).x);
    expect(xs).not.toContain(0.2);
    expect(xs).toContain(0.3);
  });

  it('never drops a click, however far behind the queue is', async () => {
    const { backend, release, injected } = blockingBackend();
    const injector = makeInjector(backend);
    injector.enable();

    const all = [
      injector.inject(move(0.1)),
      injector.inject(move(0.2)),
      injector.inject(click),
      injector.inject(move(0.3)),
    ];

    await drain(release, all);

    expect(injected.some((e) => 'action' in e && e.action === 'down')).toBe(true);
  });

  // Intermediate motion is the entire content of a drag: anything tracking one
  // (text selection, canvas apps, file managers) needs the path, not just its
  // endpoints.
  it('keeps every move while a button is held', async () => {
    const { backend, release, injected } = blockingBackend();
    const injector = makeInjector(backend);
    injector.enable();

    const down = injector.inject(click);
    await drain(release, [down]);

    const drag = [injector.inject(move(0.2)), injector.inject(move(0.3))];
    await drain(release, drag);

    const xs = injected.filter((e) => 'x' in e).map((e) => (e as { x: number }).x);
    expect(xs).toContain(0.2);
    expect(xs).toContain(0.3);
  });

  it('reports and injects where the viewer stopped after coalescing', async () => {
    const { backend, release, injected } = blockingBackend();
    const injector = makeInjector(backend);
    injector.enable();

    const inFlight = injector.inject(move(0.1));
    await Promise.resolve();
    const dropped = injector.inject(move(0.9));

    await drain(release, [inFlight, dropped]);

    // The overlay still has to draw the guest's cursor where they left it.
    expect(injector.getRemoteCursorPosition().x).toBe(0.9);
    expect(injected.some((event) => 'x' in event && event.x === 0.9)).toBe(true);
  });

  it('counts what it dropped, so a laggy host can be told apart from a busy one', async () => {
    const { backend, release } = blockingBackend();
    const injector = makeInjector(backend);
    injector.enable();

    const inFlight = injector.inject(move(0.1));
    await Promise.resolve();
    const dropped = injector.inject(move(0.2));

    await drain(release, [inFlight, dropped]);

    expect(injector.getDiagnostics().stats.coalesced).toBeGreaterThan(0);
  });
});
