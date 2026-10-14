import type { AbstractIntlMessages } from 'next-intl';
import { DEFAULT_LOCALE, type Locale } from './locales';
import en from '../../messages/en.json';

/** Deep-merge `override` onto `base` (objects merge, leaves replace). */
export function mergeMessages(
  base: AbstractIntlMessages,
  override: AbstractIntlMessages
): AbstractIntlMessages {
  const result: AbstractIntlMessages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] =
      typeof value === 'object' && typeof existing === 'object'
        ? mergeMessages(existing, value)
        : value;
  }
  return result;
}

/**
 * Messages for a locale, with English filling any key a translation lacks so a
 * missing string renders in English instead of as its key path.
 */
export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  if (locale === DEFAULT_LOCALE) return en;
  const translated = (await import(`../../messages/${locale}.json`)) as {
    default: AbstractIntlMessages;
  };
  return mergeMessages(en, translated.default);
}
