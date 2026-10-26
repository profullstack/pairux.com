import { describe, expect, it } from 'vitest';
import { sameOriginPath } from './safe-redirect';

describe('sameOriginPath', () => {
  it('keeps same-site paths', () => {
    expect(sameOriginPath('/dashboard')).toBe('/dashboard');
    expect(sameOriginPath('/r/abc?x=1#k=2')).toBe('/r/abc?x=1#k=2');
  });

  it('rejects anything that can leave the site', () => {
    for (const bad of [
      null,
      '',
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      '/\\/evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      'javascript:alert(1)',
    ]) {
      expect(sameOriginPath(bad)).toBeNull();
    }
  });
});
