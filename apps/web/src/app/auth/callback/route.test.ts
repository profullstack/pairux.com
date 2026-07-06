import { describe, expect, it } from 'vitest';

import { safeNextPath } from './route';

describe('safeNextPath', () => {
  it('keeps internal callback paths', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/session/abc?tab=chat')).toBe('/session/abc?tab=chat');
  });

  it('falls back for external callback targets', () => {
    expect(safeNextPath('https://evil.example/phish')).toBe('/dashboard');
    expect(safeNextPath('//evil.example/phish')).toBe('/dashboard');
  });

  it('falls back for missing or relative callback targets', () => {
    expect(safeNextPath(null)).toBe('/dashboard');
    expect(safeNextPath('dashboard')).toBe('/dashboard');
  });
});
