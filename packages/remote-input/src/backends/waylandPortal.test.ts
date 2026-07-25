import { describe, expect, it } from 'vitest';
import {
  WaylandPortalInputBackend,
  probeWaylandPortalSupport,
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
  it('surfaces portal-detected but unimplemented status', async () => {
    const probe: WaylandPortalProbe = {
      hasDbusSession: true,
      hasGdbus: true,
      portalDesktopAvailable: true,
      portalDesktopOwned: true,
      portalDesktopName: 'org.freedesktop.portal.Desktop',
      portalImplDetected: 'org.freedesktop.impl.portal.desktop.kde',
      currentDesktop: 'KDE',
    };

    const backend = new WaylandPortalInputBackend(probe);

    expect(backend.name).toBe('wayland-portal');
    expect(backend.supported).toBe(false);
    expect(backend.reason).toMatch(/not implemented/i);
    expect(backend.details).toMatchObject({
      portalDesktopAvailable: true,
      portalImplDetected: 'org.freedesktop.impl.portal.desktop.kde',
      implemented: false,
    });

    await expect(backend.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 })).rejects.toThrow(
      /portal/i
    );
  });
});
