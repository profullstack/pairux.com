import { describe, it, expect } from 'vitest';
import { getInputBackendSelection, selectInputBackend } from './factory.js';
import { detectDisplayServer, requiresAccessibilityPermission } from './platform.js';

describe('selectInputBackend', () => {
  it('uses nut-js on macOS', () => {
    expect(selectInputBackend('darwin', 'macos')).toBe('nut-js');
  });

  it('uses nut-js on Windows', () => {
    expect(selectInputBackend('win32', 'windows')).toBe('nut-js');
  });

  it('uses nut-js on Linux X11', () => {
    expect(selectInputBackend('linux', 'x11')).toBe('nut-js');
  });

  // Wayland refuses synthetic input from ordinary clients, so it cannot share
  // the X11 path.
  it('prefers the Wayland portal backend on Linux Wayland', () => {
    expect(selectInputBackend('linux', 'wayland')).toBe('wayland-portal');
  });
});

describe('getInputBackendSelection', () => {
  it('passes through explicit platform and display server', () => {
    expect(getInputBackendSelection('darwin', 'macos')).toEqual({
      kind: 'nut-js',
      platform: 'darwin',
      displayServer: 'macos',
    });
  });
});

describe('detectDisplayServer', () => {
  it('maps macOS and Windows without consulting the environment', () => {
    expect(detectDisplayServer('darwin')).toBe('macos');
    expect(detectDisplayServer('win32')).toBe('windows');
  });

  it('reports wayland when the session type says so', () => {
    const previous = process.env.XDG_SESSION_TYPE;
    process.env.XDG_SESSION_TYPE = 'wayland';
    try {
      expect(detectDisplayServer('linux')).toBe('wayland');
    } finally {
      if (previous === undefined) delete process.env.XDG_SESSION_TYPE;
      else process.env.XDG_SESSION_TYPE = previous;
    }
  });
});

describe('requiresAccessibilityPermission', () => {
  it('is only true on macOS', () => {
    expect(requiresAccessibilityPermission('darwin')).toBe(true);
    expect(requiresAccessibilityPermission('win32')).toBe(false);
    expect(requiresAccessibilityPermission('linux')).toBe(false);
  });
});
