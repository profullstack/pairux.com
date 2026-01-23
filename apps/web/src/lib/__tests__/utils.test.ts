import { describe, it, expect, vi, afterEach } from 'vitest';
import { cn, detectOS, formatNumber } from '../utils';

describe('cn (className merge)', () => {
  it('should merge simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should handle conditional classes', () => {
    // Testing cn's ability to handle falsy values passed directly
    expect(cn('foo', 'bar', false)).toBe('foo bar');
    expect(cn('foo', undefined, 'bar')).toBe('foo bar');
  });

  it('should handle undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });

  it('should merge Tailwind classes correctly', () => {
    expect(cn('px-4', 'px-6')).toBe('px-6');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('should handle arrays', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('should handle objects', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('should handle complex combinations', () => {
    expect(cn('base-class', { conditional: true }, ['array', 'classes'], undefined, 'final')).toBe(
      'base-class conditional array classes final'
    );
  });
});

describe('formatNumber', () => {
  it('should format numbers under 1000', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(100)).toBe('100');
    expect(formatNumber(999)).toBe('999');
  });

  it('should format thousands with k suffix', () => {
    expect(formatNumber(1000)).toBe('1.0k');
    expect(formatNumber(1500)).toBe('1.5k');
    expect(formatNumber(10000)).toBe('10.0k');
    expect(formatNumber(999999)).toBe('1000.0k');
  });

  it('should format millions with M suffix', () => {
    expect(formatNumber(1000000)).toBe('1.0M');
    expect(formatNumber(1500000)).toBe('1.5M');
    expect(formatNumber(10000000)).toBe('10.0M');
  });
});

describe('detectOS', () => {
  afterEach(() => {
    // Reset window and navigator
    vi.unstubAllGlobals();
  });

  it('should return unknown on server (no window)', () => {
    vi.stubGlobal('window', undefined);
    const result = detectOS();
    expect(result.os).toBe('unknown');
    expect(result.arch).toBe('unknown');
  });

  it('should detect macOS', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });

    const result = detectOS();
    expect(result.os).toBe('macos');
    expect(result.arch).toBe('x64');
  });

  it('should detect macOS ARM', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; ARM Mac OS X)',
    });

    const result = detectOS();
    expect(result.os).toBe('macos');
    expect(result.arch).toBe('arm64');
  });

  it('should detect Windows', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });

    const result = detectOS();
    expect(result.os).toBe('windows');
    expect(result.arch).toBe('x64');
  });

  it('should detect Linux', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    });

    const result = detectOS();
    expect(result.os).toBe('linux');
    expect(result.arch).toBe('x64');
  });
});
