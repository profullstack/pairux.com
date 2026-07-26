import { describe, it, expect } from 'vitest';
import { KWinCursorProvider, buildKWinScript } from './kwinCursorProvider.js';

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

  // cursorPosChanged fires on every motion event; unthrottled that is a DBus
  // call per pixel.
  it('throttles by distance', () => {
    expect(script).toMatch(/Math\.abs\(p\.x - lastX\) < \d+/);
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
