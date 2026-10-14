import { describe, expect, it } from 'vitest';
import { defaultListenLanguage, isTranslationLanguage, languageName } from './languages';

describe('translation languages', () => {
  it('defaults to the browser language, else English', () => {
    expect(defaultListenLanguage(['vi-VN', 'en-US'])).toBe('vi');
    expect(defaultListenLanguage(['nb-NO'])).toBe('no');
    expect(defaultListenLanguage(['tl'])).toBe('fil');
    expect(defaultListenLanguage(['xx', 'fr-CA'])).toBe('fr');
    expect(defaultListenLanguage([])).toBe('en');
  });
  it('names languages natively and rejects unknown codes', () => {
    expect(languageName('de')).toBe('Deutsch');
    expect(isTranslationLanguage('fr')).toBe(true);
    expect(isTranslationLanguage('klingon')).toBe(false);
  });
});
