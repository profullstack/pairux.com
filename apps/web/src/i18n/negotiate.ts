import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';

/**
 * Parse an Accept-Language header into language tags ordered by preference
 * (highest q first; ties keep header order). q=0 entries are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [rawTag = '', ...params] = part.trim().split(';');
      let q = 1;
      for (const param of params) {
        const [key, value] = param.trim().split('=');
        if (key === 'q' && value !== undefined) {
          const parsed = Number.parseFloat(value);
          q = Number.isNaN(parsed) ? 0 : parsed;
        }
      }
      return { tag: rawTag.trim().toLowerCase(), q, index };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

/**
 * Best supported locale for an Accept-Language header, or null. Matches the
 * exact tag first, then its primary subtag (pt-BR -> pt, zh-Hant-TW -> zh).
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  for (const tag of parseAcceptLanguage(header)) {
    if (isLocale(tag)) return tag;
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/**
 * Locale resolution order: the NEXT_LOCALE cookie (set by the language
 * switcher), then the best Accept-Language match, then the default (en).
 */
export function resolveLocale({
  cookie,
  acceptLanguage,
}: {
  cookie?: string | null | undefined;
  acceptLanguage?: string | null | undefined;
}): Locale {
  if (isLocale(cookie)) return cookie;
  return matchAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
