import { describe, it, expect, afterEach } from 'vitest';
import {
  KWinCursorProvider,
  buildKWinScript,
  isKWinCursorRestoreEnabled,
} from './kwinCursorProvider.js';

const silent = { log: () => {}, warn: () => {} };

describe('buildKWinScript', () => {
  const script = buildKWinScript();

  // The script's only way out is callDBus, and the bus rejects calls to a name
  // nobody owns — so these must match what the provider claims.
  it('pushes to the name and path the provider owns', () => {
    expect(script).toContain("'org.profullstack.RemoteInput'");
    expect(script).toContain("'/org/profullstack/RemoteInput'");
    expect(script).toContain("'SetCursorPos'");
  });

  it('reads the pointer from the compositor', () => {
    expect(script).toContain('workspace.cursorPos');
  });

  // This runs in KWin's input path. cursorPosChanged fires on every motion
  // event, so the DBus rate must be capped by TIME — a per-distance cap scales
  // with mouse speed and can flood the compositor badly enough to freeze the
  // whole desktop.
  it('caps the report rate by elapsed time, not distance', () => {
    expect(script).toContain('MIN_INTERVAL_MS');
    expect(script).toMatch(/now - lastSent < MIN_INTERVAL_MS/);
    expect(script).not.toMatch(/Math\.abs\(p\.x - lastX\)/);
  });

  // A name that is not owned would otherwise fail on every single motion event.
  it('gives up after repeated DBus failures', () => {
    expect(script).toContain('MAX_FAILURES');
    expect(script).toMatch(/stopped = true/);
  });

  // KWin generations differ; a missing signal must not throw inside KWin.
  it('guards against the notify signal being absent', () => {
    expect(script).toContain("typeof workspace.cursorPosChanged !== 'undefined'");
  });

  it('reports once at load so a still pointer is known immediately', () => {
    expect(script).toMatch(/\nreport\(\);/);
  });
});

describe('KWinCursorProvider', () => {
  // Restoring the pointer is a comfort; the only way to do it puts our code in
  // the compositor's input path, where a mistake costs the user their desktop.
  // So it stays off until explicitly asked for.
  it('does nothing where the helper does not apply', async () => {
    process.env.PAIRUX_WAYLAND_CURSOR_RESTORE = '0';
    const provider = new KWinCursorProvider({ logger: silent });
    await expect(provider.start()).resolves.toBe(false);
    expect(provider.isAvailable).toBe(false);
  });

  it('reports no position before the compositor has said anything', () => {
    const provider = new KWinCursorProvider({ logger: silent });
    expect(provider.getPosition()).toBeNull();
    expect(provider.isAvailable).toBe(false);
  });

  // Restoring the pointer to a stale reading would move it somewhere the user
  // never left it, which is worse than not restoring at all.
  it('discards a reading that has gone stale', () => {
    const provider = new KWinCursorProvider({ logger: silent });
    const withPosition = provider as unknown as {
      position: { x: number; y: number; at: number } | null;
    };

    withPosition.position = { x: 100, y: 200, at: Date.now() };
    expect(provider.getPosition()).toEqual({ x: 100, y: 200 });

    withPosition.position = { x: 100, y: 200, at: Date.now() - 10_000 };
    expect(provider.getPosition()).toBeNull();
  });
});

describe('isKWinCursorRestoreEnabled', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  function env(vars: Record<string, string | undefined>): void {
    delete process.env.PAIRUX_WAYLAND_CURSOR_RESTORE;
    delete process.env.XDG_SESSION_TYPE;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.XDG_CURRENT_DESKTOP;
    for (const [k, v] of Object.entries(vars)) {
      if (v !== undefined) process.env[k] = v;
    }
  }

  // The helper only targets KDE on Wayland, and a user should not have to
  // discover an env var to get working pointer restore there.
  it('is on for a KDE Wayland session', () => {
    env({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE' });
    expect(isKWinCursorRestoreEnabled()).toBe(true);
  });

  it('is off where the helper does not apply', () => {
    env({ XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'KDE' });
    expect(isKWinCursorRestoreEnabled()).toBe(false);

    env({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME' });
    expect(isKWinCursorRestoreEnabled()).toBe(false);
  });

  // An escape hatch matters: this hooks the compositor's input path.
  it('can be forced off', () => {
    env({
      XDG_SESSION_TYPE: 'wayland',
      XDG_CURRENT_DESKTOP: 'KDE',
      PAIRUX_WAYLAND_CURSOR_RESTORE: '0',
    });
    expect(isKWinCursorRestoreEnabled()).toBe(false);
  });

  it('can be forced on for a session that does not advertise itself', () => {
    env({ PAIRUX_WAYLAND_CURSOR_RESTORE: '1' });
    expect(isKWinCursorRestoreEnabled()).toBe(true);
  });
});
