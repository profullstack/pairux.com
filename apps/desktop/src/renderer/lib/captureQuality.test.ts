import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CAPTURE_RESOLUTION,
  DEFAULT_QUALITY,
  fitWithin,
  qualityResolution,
  readQualitySetting,
} from './captureQuality';

describe('fitWithin', () => {
  const hd = CAPTURE_RESOLUTION['1080p'];

  it('shrinks a 4K source into the 1080p budget', () => {
    // The case that matters: Chromium hands back a native 4K desktop track
    // even when the user asked for 1080p.
    expect(fitWithin({ width: 3840, height: 2160 }, hd)).toEqual({ width: 1920, height: 1080 });
  });

  it('leaves a source already within budget alone', () => {
    // Upscaling would buy no detail and cost real pixels.
    expect(fitWithin({ width: 1280, height: 720 }, hd)).toEqual({ width: 1280, height: 720 });
  });

  it('preserves aspect ratio for an ultrawide source', () => {
    const fitted = fitWithin({ width: 3440, height: 1440 }, hd);
    expect(fitted.width).toBe(1920);
    // 1440 * (1920/3440) = 803.7, floored to even.
    expect(fitted.height).toBe(802);
    expect(Math.abs(fitted.width / fitted.height - 3440 / 1440)).toBeLessThan(0.05);
  });

  it('preserves aspect ratio for a portrait source', () => {
    const fitted = fitWithin({ width: 1080, height: 1920 }, hd);
    expect(fitted.height).toBe(1080);
    expect(fitted.width).toBe(606);
  });

  it('keeps both axes even for 4:2:0 chroma', () => {
    const fitted = fitWithin({ width: 1365, height: 767 }, hd);
    expect(fitted.width % 2).toBe(0);
    expect(fitted.height % 2).toBe(0);
  });

  it('never exceeds the budget it was given', () => {
    // Rounding to the nearest multiple of 16 used to turn a 1080 bound into
    // 1088 — overshooting the limit the caller asked for.
    for (const source of [
      { width: 3840, height: 2160 },
      { width: 2560, height: 1440 },
      { width: 3440, height: 1440 },
      { width: 1080, height: 1920 },
    ]) {
      const fitted = fitWithin(source, hd);
      expect(fitted.width).toBeLessThanOrEqual(hd.width);
      expect(fitted.height).toBeLessThanOrEqual(hd.height);
    }
  });

  it('never returns a zero dimension for a degenerate source', () => {
    expect(fitWithin({ width: 0, height: 0 }, hd)).toEqual(hd);
    const sliver = fitWithin({ width: 3840, height: 1 }, hd);
    expect(sliver.width).toBeGreaterThan(0);
    expect(sliver.height).toBeGreaterThan(0);
  });
});

describe('readQualitySetting', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults when nothing is stored', () => {
    expect(readQualitySetting()).toBe(DEFAULT_QUALITY);
  });

  it('reads the stored quality', () => {
    store.set('pairux-settings', JSON.stringify({ recording: { defaultQuality: '720p' } }));
    expect(readQualitySetting()).toBe('720p');
    expect(qualityResolution()).toEqual({ width: 1280, height: 720 });
  });

  it('ignores a quality it does not recognise', () => {
    store.set('pairux-settings', JSON.stringify({ recording: { defaultQuality: '8k' } }));
    expect(readQualitySetting()).toBe(DEFAULT_QUALITY);
  });

  it('survives corrupt JSON rather than failing the capture', () => {
    store.set('pairux-settings', '{not json');
    expect(readQualitySetting()).toBe(DEFAULT_QUALITY);
  });
});
