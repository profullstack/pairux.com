'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  localeDirection,
  localeName,
  type Locale,
} from '@/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * Persist a locale choice: the NEXT_LOCALE cookie drives server rendering
 * (see src/i18n/request.ts); localStorage keeps a copy for this browser.
 */
export function persistLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${String(LOCALE_COOKIE_MAX_AGE)}; samesite=lax`;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode); the cookie is what matters.
  }
}

interface LanguageSwitcherProps {
  className?: string;
  /** Show the visible "Language" label next to the select. */
  showLabel?: boolean;
  id?: string;
}

export function LanguageSwitcher({
  className,
  showLabel = false,
  id = 'language-switcher',
}: LanguageSwitcherProps) {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: Locale) {
    if (next === locale) return;
    persistLocale(next);
    document.documentElement.lang = next;
    document.documentElement.dir = localeDirection(next);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label htmlFor={id} className={showLabel ? 'text-sm text-gray-700' : 'sr-only'}>
        {t('language')}
      </label>
      {!showLabel && <Languages className="h-4 w-4 text-gray-500" aria-hidden="true" />}
      <select
        id={id}
        value={locale}
        disabled={isPending}
        onChange={(event) => {
          handleChange(event.target.value as Locale);
        }}
        className="rounded-md border border-gray-300 bg-white py-1 pr-7 pl-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none disabled:opacity-60"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {localeName(code)}
          </option>
        ))}
      </select>
    </div>
  );
}
