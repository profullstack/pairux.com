import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE } from './locales';
import { loadMessages } from './messages';
import { resolveLocale } from './negotiate';

// No locale-prefixed routes: every URL stays the same and the locale comes
// from the NEXT_LOCALE cookie, then Accept-Language, then English.
export default getRequestConfig(async () => {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get('accept-language'),
  });
  return { locale, messages: await loadMessages(locale) };
});
