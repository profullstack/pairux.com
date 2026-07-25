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
