import { describe, expect, it } from 'vitest';
import { accelPlatformFor } from './viewerPlatform';

describe('accelPlatformFor', () => {
  it('detects a Mac from userAgentData', () => {
    expect(accelPlatformFor('macOS')).toBe('darwin');
  });

  it('detects a Mac from a user agent string', () => {
    expect(
      accelPlatformFor(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
      )
    ).toBe('darwin');
  });

  it('treats Linux and Windows as the Ctrl platform', () => {
    expect(accelPlatformFor('Linux x86_64')).toBe('other');
    expect(accelPlatformFor('Mozilla/5.0 (X11; Linux x86_64)')).toBe('other');
    expect(accelPlatformFor('Windows')).toBe('other');
    expect(accelPlatformFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
  });

  // Never throws during render: a wrong modifier beats a blank screen.
  it('falls back to the Ctrl platform without a hint', () => {
    expect(accelPlatformFor(undefined)).toBe('other');
    expect(accelPlatformFor(null)).toBe('other');
    expect(accelPlatformFor('')).toBe('other');
  });
});
