import { describe, expect, it, vi } from 'vitest';

vi.mock('../platform', () => ({
  detectDisplayServer: vi.fn().mockReturnValue('x11'),
}));

import { selectInputBackend } from './backendFactory';

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

  it('prefers the Wayland portal backend on Linux Wayland', () => {
    expect(selectInputBackend('linux', 'wayland')).toBe('wayland-portal');
  });
});
