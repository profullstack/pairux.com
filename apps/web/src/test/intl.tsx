/**
 * Test helpers for components that call next-intl hooks.
 *
 * `render` / `renderHook` here are drop-in replacements for the ones in
 * @testing-library/react that wrap the tree in a NextIntlClientProvider with
 * the real English messages (or another locale via `{ locale }`), so existing
 * assertions on English copy keep working unchanged:
 *
 *   import { render, screen } from '@/test/intl';
 *   render(<LoginForm />);                 // English
 *   render(<LoginForm />, { locale: 'es' }); // Spanish
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderOptions,
  type RenderResult,
  type RenderHookResult,
} from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import { mergeMessages } from '@/i18n/messages';
import en from '../../messages/en.json';

export * from '@testing-library/react';

const MESSAGES_DIR = path.resolve(__dirname, '../../messages');

/** English messages, or `locale`'s with English filling any gap (as at runtime). */
export function messagesFor(locale: Locale = DEFAULT_LOCALE): AbstractIntlMessages {
  if (locale === DEFAULT_LOCALE) return en;
  const file = path.join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(file)) return en;
  return mergeMessages(en, JSON.parse(readFileSync(file, 'utf8')) as AbstractIntlMessages);
}

export interface IntlOptions {
  locale?: Locale;
  messages?: AbstractIntlMessages;
}

export function IntlWrapper({
  children,
  locale = DEFAULT_LOCALE,
  messages,
}: IntlOptions & { children: ReactNode }) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages ?? messagesFor(locale)}
      timeZone="UTC"
      onError={() => undefined}
    >
      {children}
    </NextIntlClientProvider>
  );
}

function wrapperFor(
  options: IntlOptions,
  Inner?: React.JSXElementConstructor<{ children: ReactNode }>
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <IntlWrapper {...options}>{Inner ? <Inner>{children}</Inner> : children}</IntlWrapper>;
  };
}

export function render(ui: ReactElement, options: RenderOptions & IntlOptions = {}): RenderResult {
  const { locale, messages, wrapper, ...rest } = options;
  const intl: IntlOptions = {};
  if (locale) intl.locale = locale;
  if (messages) intl.messages = messages;
  return rtlRender(ui, { ...rest, wrapper: wrapperFor(intl, wrapper) });
}

export function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options: RenderHookOptions<Props> & IntlOptions = {}
): RenderHookResult<Result, Props> {
  const { locale, messages, wrapper, ...rest } = options;
  const intl: IntlOptions = {};
  if (locale) intl.locale = locale;
  if (messages) intl.messages = messages;
  return rtlRenderHook(callback, { ...rest, wrapper: wrapperFor(intl, wrapper) });
}
