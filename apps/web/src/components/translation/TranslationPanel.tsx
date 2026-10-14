'use client';

import { useState } from 'react';
import { Languages } from 'lucide-react';
import type { MeetingTranslation } from '@/hooks/useMeetingTranslation';
import { TRANSLATION_LANGUAGES, languageName } from '@/lib/translation/languages';

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

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** Live translation controls for one listener in a meeting. */
export function TranslationPanel({
  translation,
  className = '',
}: {
  translation: MeetingTranslation;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState('');
  const t = translation;
  if (!t.available) return null;

  return (
    <section
      aria-label="Live translation"
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
          Live translation
          {t.listening > 0 && !t.enabled && (
            <span className="ml-2 text-xs font-normal text-gray-400">in use by {t.listening}</span>
          )}
        </button>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            role="switch"
            checked={t.enabled}
            disabled={!t.funded && !t.enabled}
            onChange={(event) => {
              t.setEnabled(event.target.checked);
              if (event.target.checked) setOpen(true);
            }}
          />
          {t.enabled ? 'On' : 'Off'}
        </label>
      </div>

      {!t.funded && !t.isHost && (
        <p className="border-t border-gray-700 px-3 py-2 text-xs text-gray-400">
          Live translation is a paid feature. Ask the host to get a translation pass.
        </p>
      )}

      {(open || (!t.funded && t.isHost)) && (
        <div className="space-y-3 border-t border-gray-700 px-3 py-3">
          {!t.funded && t.isHost && (
            <p className="text-xs text-amber-300">
              Live translation is a paid feature. Buy a pass below so everyone in your meetings can
              hear and read each other in their own language.
            </p>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="translation-listen-to" className="text-xs text-gray-400">
              Hear everyone in
            </label>
            <LanguageSelect
              id="translation-listen-to"
              label="Hear everyone in"
              value={t.listenTo}
              onChange={t.setListenTo}
            />
          </div>

          {t.participants.length === 0 ? (
            <p className="text-xs text-gray-400">Nobody else is speaking in this meeting yet.</p>
          ) : (
            <ul className="space-y-2">
              {t.participants.map((one) => {
                const choice = t.choiceFor(one.identity);
                const base = `translation-${one.identity}`;
                return (
                  <li key={one.identity} className="rounded bg-gray-800/60 p-2">
                    <div className="mb-1 truncate text-xs font-medium text-white">{one.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <LanguageSelect
                        id={`${base}-from`}
                        label={`${one.name} speaks`}
                        value={choice.from}
                        empty="Detect"
                        onChange={(from) => {
                          t.setChoice(one.identity, { from });
                        }}
                      />
                      <span aria-hidden="true">→</span>
                      <LanguageSelect
                        id={`${base}-to`}
                        label={`Hear ${one.name} in`}
                        value={choice.to}
                        empty="Original"
                        onChange={(to) => {
                          t.setChoice(one.identity, { to });
                        }}
                      />
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={choice.audio && choice.to !== ''}
                          disabled={choice.to === ''}
                          onChange={(event) => {
                            t.setChoice(one.identity, { audio: event.target.checked });
                          }}
                        />
                        Voice
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={choice.text}
                          onChange={(event) => {
                            t.setChoice(one.identity, { text: event.target.checked });
                          }}
                        />
                        Text
                      </label>
                    </div>
                    {t.errors[one.identity] && (
                      <p className="mt-1 text-xs text-red-400">{t.errors[one.identity]}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <label className="flex items-center gap-2 text-xs text-gray-400">
            Original voice under translation
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={t.originalVolume}
              onChange={(event) => {
                t.setOriginalVolume(Number(event.target.value));
              }}
              className="flex-1"
            />
          </label>

          <p role="status" aria-live="polite" className="min-h-4 text-xs text-gray-400">
            {t.message}
          </p>

          {t.lines.length > 0 && (
            <div
              className="max-h-48 overflow-y-auto rounded bg-black/30 p-2"
              aria-label="Translated transcript"
            >
              <ol className="space-y-1">
                {t.lines.slice(-60).map((line) => (
                  <li key={line.id} className="text-xs">
                    <span className="font-medium text-gray-300">{line.name}: </span>
                    <span className="text-gray-100">{line.text}</span>
                    {line.original && line.original !== line.text && (
                      <span className="block text-gray-500">{line.original}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {t.isHost && t.access && (
            <div className="space-y-1 rounded border border-gray-700 p-2 text-xs">
              <p>
                You pay for translation in your meetings.
                {t.access.freeLimit > 0 && (
                  <>
                    {' '}
                    Free today: {t.access.freeLeft} of {t.access.freeLimit} meetings.
                  </>
                )}
                {t.access.balanceMicros > 0 && t.access.expires && (
                  <>
                    {' '}
                    Credit {usd(t.access.balanceMicros)} until{' '}
                    {new Date(t.access.expires).toLocaleDateString()}.
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {t.passes.map((pass) => (
                  <button
                    key={pass.id}
                    type="button"
                    disabled={buying !== null}
                    onClick={() => {
                      setBuying(pass.id);
                      setBuyError('');
                      t.buyPass(pass.id)
                        .catch((error: unknown) => {
                          setBuyError(
                            error instanceof Error ? error.message : 'Checkout is unavailable.'
                          );
                        })
                        .finally(() => {
                          setBuying(null);
                        });
                    }}
                    className="bg-primary-600 hover:bg-primary-500 rounded px-2 py-1 text-white disabled:opacity-50"
                  >
                    {pass.name} · ${pass.priceUsd}
                  </button>
                ))}
              </div>
              {buyError && <p className="text-red-400">{buyError}</p>}
            </div>
          )}

          <p className="text-[11px] leading-snug text-gray-500">
            Speech you choose to translate is sent to ElevenLabs (recognition and voices) and
            Anthropic (translation). Nothing is recorded or stored. Languages:{' '}
            {languageName(t.listenTo)} and {TRANSLATION_LANGUAGES.length - 1} more.
          </p>
        </div>
      )}
    </section>
  );
}
