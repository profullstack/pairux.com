import { describe, expect, it, vi } from 'vitest';
import {
  WaylandPortalInputBackend,
  probeWaylandPortalSupport,
  type RemoteDesktopPortal,
  type WaylandPortalProbe,
} from './waylandPortal.js';

describe('probeWaylandPortalSupport', () => {
  it('reports missing DBus session before probing names', () => {
    const original = process.env.DBUS_SESSION_BUS_ADDRESS;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;

    try {
      const probe = probeWaylandPortalSupport(() => {
        throw new Error('should not be called');
      });

      expect(probe.hasDbusSession).toBe(false);
      expect(probe.portalDesktopAvailable).toBe(false);
      expect(probe.error).toMatch(/DBUS_SESSION_BUS_ADDRESS/i);
    } finally {
      if (original) {
        process.env.DBUS_SESSION_BUS_ADDRESS = original;
      }
    }
  });

  it('detects portal desktop ownership when DBus/session probe succeeds', () => {
    const original = process.env.DBUS_SESSION_BUS_ADDRESS;
    process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/tmp/fake-bus';

    try {
      const probe = probeWaylandPortalSupport(
        (name) =>
          name === 'org.freedesktop.portal.Desktop' ||
          name === 'org.freedesktop.impl.portal.desktop.kde'
      );

      // This test environment may not have gdbus installed, so only assert when probe gets past that gate.
      if (probe.hasGdbus) {
        expect(probe.portalDesktopAvailable).toBe(true);
        expect(probe.portalImplDetected).toBe('org.freedesktop.impl.portal.desktop.kde');
      } else {
        expect(probe.error).toMatch(/gdbus/i);
      }
    } finally {
      if (original) {
        process.env.DBUS_SESSION_BUS_ADDRESS = original;
      } else {
        delete process.env.DBUS_SESSION_BUS_ADDRESS;
      }
    }
  });
});

describe('WaylandPortalInputBackend', () => {
  const probe: WaylandPortalProbe = {
    hasDbusSession: true,
    hasGdbus: true,
    portalDesktopAvailable: true,
    portalDesktopOwned: true,
    portalDesktopName: 'org.freedesktop.portal.Desktop',
    portalImplDetected: 'org.freedesktop.impl.portal.desktop.kde',
    currentDesktop: 'KDE',
  };

  function fakePortal(): RemoteDesktopPortal {
    return {
      start: vi.fn().mockResolvedValue({ devices: 3 }),
      pointerMotion: vi.fn().mockResolvedValue(undefined),
      pointerButton: vi.fn().mockResolvedValue(undefined),
      pointerAxisDiscrete: vi.fn().mockResolvedValue(undefined),
      keyboardKeycode: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('uses the approved portal session for pointer and keyboard input', async () => {
    const portal = fakePortal();
    const backend = new WaylandPortalInputBackend(probe, portal, async () => ({
      width: 1920,
      height: 1080,
    }));

    await backend.init();
    await backend.activate();
    await backend.inject({ type: 'mouse', action: 'move', x: 0.6, y: 0.4 });
    await backend.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.6, y: 0.4 });
    await backend.inject({
      type: 'keyboard',
      action: 'press',
      key: 'a',
      code: 'KeyA',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
    });

    expect(backend.name).toBe('wayland-portal');
    expect(backend.supported).toBe(true);
    expect(backend.details).toMatchObject({
      portalDesktopAvailable: true,
      portalImplDetected: 'org.freedesktop.impl.portal.desktop.kde',
      implemented: true,
      portalSessionActive: true,
    });
    expect(portal.start).toHaveBeenCalledOnce();
    expect(portal.pointerMotion).toHaveBeenCalledWith(192, -108);
    expect(portal.pointerButton).toHaveBeenCalledWith(272, true);
    expect(portal.keyboardKeycode).toHaveBeenNthCalledWith(1, 30, true);
    expect(portal.keyboardKeycode).toHaveBeenNthCalledWith(2, 30, false);
  });

  it('releases held portal input before closing the session', async () => {
    const portal = fakePortal();
    const backend = new WaylandPortalInputBackend(probe, portal);
    await backend.activate();
    await backend.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.5, y: 0.5 });
    await backend.inject({
      type: 'keyboard',
      action: 'down',
      key: 'a',
      code: 'KeyA',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
    });

    await backend.dispose();

    expect(portal.pointerButton).toHaveBeenLastCalledWith(272, false);
    expect(portal.keyboardKeycode).toHaveBeenLastCalledWith(30, false);
    expect(portal.close).toHaveBeenCalledOnce();
  });

  it('positions the shared pointer before a first button event', async () => {
    const portal = fakePortal();
    const backend = new WaylandPortalInputBackend(probe, portal, async () => ({
      width: 1920,
      height: 1080,
    }));
    await backend.init();
    await backend.activate();

    await backend.inject({ type: 'mouse', action: 'down', button: 'left', x: 0.75, y: 0.25 });

    expect(portal.pointerMotion).toHaveBeenCalledWith(480, -270);
    expect(portal.pointerButton).toHaveBeenCalledWith(272, true);
  });

  it('reports a denied KDE approval and leaves the portal closed', async () => {
    const portal = fakePortal();
    vi.mocked(portal.start).mockRejectedValueOnce(new Error('response 1'));
    const backend = new WaylandPortalInputBackend(probe, portal);

    await expect(backend.activate()).rejects.toThrow('response 1');

    expect(backend.reason).toMatch(/permission was not granted/i);
    expect(backend.details).toMatchObject({
      portalSessionActive: false,
      portalError: 'response 1',
    });
    expect(portal.close).toHaveBeenCalledOnce();
  });
});
