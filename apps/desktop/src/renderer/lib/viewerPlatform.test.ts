import { afterEach, describe, expect, it } from 'vitest';
import { accelPlatformFor, getAccelPlatform } from './viewerPlatform';

describe('accelPlatformFor', () => {
  it('treats darwin as the Cmd platform', () => {
    expect(accelPlatformFor('darwin')).toBe('darwin');
  });

  it('treats everything else as the Ctrl platform', () => {
    expect(accelPlatformFor('linux')).toBe('other');
    expect(accelPlatformFor('win32')).toBe('other');
  });

  // Never throws on render: a wrong modifier beats a blank screen.
  it('falls back to the Ctrl platform when the platform is unknown', () => {
    expect(accelPlatformFor(undefined)).toBe('other');
    expect(accelPlatformFor(null)).toBe('other');
  });
});

describe('getAccelPlatform', () => {
  afterEach(() => {
    delete (globalThis as { electronAPI?: unknown }).electronAPI;
  });

  it('reads the platform exposed by preload', () => {
    (globalThis as { electronAPI?: unknown }).electronAPI = { platform: 'darwin' };
    expect(getAccelPlatform()).toBe('darwin');
  });

  it('does not throw when preload is absent', () => {
    expect(getAccelPlatform()).toBe('other');
  });
});
