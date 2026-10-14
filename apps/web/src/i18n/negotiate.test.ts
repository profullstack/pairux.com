import { describe, expect, it } from 'vitest';
import { matchAcceptLanguage, parseAcceptLanguage, resolveLocale } from './negotiate';

describe('parseAcceptLanguage', () => {
  it('orders tags by q value, keeping header order for ties', () => {
    expect(parseAcceptLanguage('fr;q=0.5, de, en-GB;q=0.8, ja')).toEqual([
      'de',
      'ja',
      'en-gb',
      'fr',
    ]);
  });

  it('drops wildcards, q=0 and empty input', () => {
    expect(parseAcceptLanguage('*, es;q=0, it;q=0.1')).toEqual(['it']);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
});

describe('matchAcceptLanguage', () => {
  it('falls back from a regional tag to its language', () => {
    expect(matchAcceptLanguage('pt-BR,pt;q=0.9')).toBe('pt');
    expect(matchAcceptLanguage('zh-Hant-TW')).toBe('zh');
  });

  it('skips unsupported languages for the next supported one', () => {
    expect(matchAcceptLanguage('xx-YY, tlh;q=0.9, ko;q=0.5')).toBe('ko');
  });

  it('returns null when nothing is supported', () => {
    expect(matchAcceptLanguage('xx, tlh')).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('prefers the NEXT_LOCALE cookie over Accept-Language', () => {
    expect(resolveLocale({ cookie: 'de', acceptLanguage: 'fr-FR,fr;q=0.9' })).toBe('de');
  });

  it('ignores an unsupported cookie and uses Accept-Language', () => {
    expect(resolveLocale({ cookie: 'klingon', acceptLanguage: 'ar-EG' })).toBe('ar');
  });

  it('uses Accept-Language when there is no cookie', () => {
    expect(resolveLocale({ acceptLanguage: 'en-US;q=0.4, ja-JP;q=0.9' })).toBe('ja');
  });

  it('defaults to English with neither', () => {
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ cookie: null, acceptLanguage: 'xx' })).toBe('en');
  });
});
