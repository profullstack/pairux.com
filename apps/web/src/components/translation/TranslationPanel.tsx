'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import type { MeetingTranslation } from '@/hooks/useMeetingTranslation';
import { TRANSLATION_LANGUAGES } from '@/lib/translation/languages';

function LanguageSelect({
  id,
  value,
  onChange,
  empty,
  label,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  empty?: string;
  label: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className="min-w-0 rounded bg-gray-800 px-1.5 py-1 text-xs text-gray-100"
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {TRANSLATION_LANGUAGES.map(([code, name]) => (
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </select>
  );
}

/** Live translation controls for one listener in a meeting. */
export function TranslationPanel({
  translation,
  className = '',
}: {
  translation: MeetingTranslation;
  className?: string;
}) {
  const t = useTranslations('meetingTranslation');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState('');
  const tr = translation;
  if (!tr.available) return null;
  const money = (micros: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(
      micros / 1_000_000
    );

  return (
    <section
      aria-label={t('title')}
      className={`rounded-lg border border-gray-700 bg-gray-900/95 text-sm text-gray-200 ${className}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Languages className="h-4 w-4 text-gray-400" aria-hidden="true" />
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          className="flex-1 text-left font-medium text-white"
        >
          {t('title')}
          {tr.listening > 0 && !tr.enabled && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              {t('inUseBy', { count: tr.listening })}
            </span>
          )}
        </button>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            role="switch"
            checked={tr.enabled}
            disabled={!tr.funded && !tr.enabled}
            onChange={(event) => {
              tr.setEnabled(event.target.checked);
              if (event.target.checked) setOpen(true);
            }}
          />
          {tr.enabled ? t('on') : t('off')}
        </label>
      </div>

      {!tr.funded && !tr.isHost && (
        <p className="border-t border-gray-700 px-3 py-2 text-xs text-gray-400">{t('paidGuest')}</p>
      )}

      {(open || (!tr.funded && tr.isHost)) && (
        <div className="space-y-3 border-t border-gray-700 px-3 py-3">
          {!tr.funded && tr.isHost && <p className="text-xs text-amber-300">{t('paidHost')}</p>}

          <div className="flex items-center gap-2">
            <label htmlFor="translation-listen-to" className="text-xs text-gray-400">
              {t('hearEveryoneIn')}
            </label>
            <LanguageSelect
              id="translation-listen-to"
              label={t('hearEveryoneIn')}
              value={tr.listenTo}
              onChange={tr.setListenTo}
            />
          </div>

          {tr.participants.length === 0 ? (
            <p className="text-xs text-gray-400">{t('nobodyElse')}</p>
          ) : (
            <ul className="space-y-2">
              {tr.participants.map((one) => {
                const choice = tr.choiceFor(one.identity);
                const base = `translation-${one.identity}`;
                return (
                  <li key={one.identity} className="rounded bg-gray-800/60 p-2">
                    <div className="mb-1 truncate text-xs font-medium text-white">{one.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <LanguageSelect
                        id={`${base}-from`}
                        label={t('speaks', { name: one.name })}
                        value={choice.from}
                        empty={t('detect')}
                        onChange={(from) => {
                          tr.setChoice(one.identity, { from });
                        }}
                      />
                      <span aria-hidden="true">→</span>
                      <LanguageSelect
                        id={`${base}-to`}
                        label={t('hearIn', { name: one.name })}
                        value={choice.to}
                        empty={t('original')}
                        onChange={(to) => {
                          tr.setChoice(one.identity, { to });
                        }}
                      />
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={choice.audio && choice.to !== ''}
                          disabled={choice.to === ''}
                          onChange={(event) => {
                            tr.setChoice(one.identity, { audio: event.target.checked });
                          }}
                        />
                        {t('voice')}
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={choice.text}
                          onChange={(event) => {
                            tr.setChoice(one.identity, { text: event.target.checked });
                          }}
                        />
                        {t('text')}
                      </label>
                    </div>
                    {tr.errors[one.identity] && (
                      <p className="mt-1 text-xs text-red-400">{tr.errors[one.identity]}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <label className="flex items-center gap-2 text-xs text-gray-400">
            {t('originalVolume')}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={tr.originalVolume}
              onChange={(event) => {
                tr.setOriginalVolume(Number(event.target.value));
              }}
              className="flex-1"
            />
          </label>

          <p role="status" aria-live="polite" className="min-h-4 text-xs text-gray-400">
            {tr.message}
          </p>

          {tr.lines.length > 0 && (
            <div
              className="max-h-48 overflow-y-auto rounded bg-black/30 p-2"
              aria-label={t('transcript')}
            >
              <ol className="space-y-1">
                {tr.lines.slice(-60).map((line) => (
                  <li key={line.id} className="text-xs">
                    <span className="font-medium text-gray-300">{line.name}: </span>
                    <span className="text-gray-100" lang={line.language}>
                      {line.text}
                    </span>
                    {line.original && line.original !== line.text && (
                      <span className="block text-gray-500">{line.original}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {tr.isHost && tr.access && (
            <div className="space-y-1 rounded border border-gray-700 p-2 text-xs">
              <p>
                {t('youPay')}
                {tr.access.freeLimit > 0 && (
                  <> {t('freeToday', { left: tr.access.freeLeft, limit: tr.access.freeLimit })}</>
                )}
                {tr.access.balanceMicros > 0 && tr.access.expires && (
                  <>
                    {' '}
                    {t('credit', {
                      amount: money(tr.access.balanceMicros),
                      date: new Date(tr.access.expires).toLocaleDateString(locale),
                    })}
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {tr.passes.map((pass) => (
                  <button
                    key={pass.id}
                    type="button"
                    disabled={buying !== null}
                    onClick={() => {
                      setBuying(pass.id);
                      setBuyError('');
                      tr.buyPass(pass.id)
                        .catch((error: unknown) => {
                          setBuyError(
                            error instanceof Error ? error.message : t('checkoutUnavailable')
                          );
                        })
                        .finally(() => {
                          setBuying(null);
                        });
                    }}
                    className="bg-primary-600 hover:bg-primary-500 rounded px-2 py-1 text-white disabled:opacity-50"
                  >
                    {pass.id === 'translation_month' ? t('passMonth') : t('passDay')} ·{' '}
                    {money(pass.priceUsd * 1_000_000)}
                  </button>
                ))}
              </div>
              {buyError && <p className="text-red-400">{buyError}</p>}
            </div>
          )}

          <p className="text-[11px] leading-snug text-gray-500">{t('privacy')}</p>
        </div>
      )}
    </section>
  );
}
