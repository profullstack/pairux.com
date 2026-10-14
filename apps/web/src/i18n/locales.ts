/**
 * The single source of truth for the locales the web app ships.
 *
 * Safe to import from server and client code alike (no Next.js or Node
 * imports). Other features with their own language pickers (e.g. meeting
 * translation) should import from here rather than keep a second list.
 */

export const LOCALES = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'pl',
  'sv',
  'tr',
  'ru',
  'uk',
  'ar',
  'hi',
  'ja',
  'ko',
  'zh',
  'vi',
  'id',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie the language switcher writes; read first during locale negotiation. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** localStorage key mirroring the cookie, so a signed-in browser keeps its pick. */
export const LOCALE_STORAGE_KEY = 'pairux.locale';

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each locale's name written in that language (what a language picker shows). */
const NATIVE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  sv: 'Svenska',
  tr: 'Türkçe',
  ru: 'Русский',
  uk: 'Українська',
  ar: 'العربية',
  hi: 'हिन्दी',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
};

/** OpenGraph `og:locale` values (language_TERRITORY). */
const OG_LOCALES: Record<Locale, string> = {
  en: 'en_US',
  es: 'es_ES',
  fr: 'fr_FR',
  de: 'de_DE',
  pt: 'pt_BR',
  it: 'it_IT',
  nl: 'nl_NL',
  pl: 'pl_PL',
  sv: 'sv_SE',
  tr: 'tr_TR',
  ru: 'ru_RU',
  uk: 'uk_UA',
  ar: 'ar_AR',
  hi: 'hi_IN',
  ja: 'ja_JP',
  ko: 'ko_KR',
  zh: 'zh_CN',
  vi: 'vi_VN',
  id: 'id_ID',
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar']);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Native name for a locale code; unknown codes are returned unchanged. */
export function localeName(code: string): string {
  return isLocale(code) ? NATIVE_NAMES[code] : code;
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return isLocale(locale) && RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

export function ogLocale(locale: string): string {
  return isLocale(locale) ? OG_LOCALES[locale] : OG_LOCALES[DEFAULT_LOCALE];
}
