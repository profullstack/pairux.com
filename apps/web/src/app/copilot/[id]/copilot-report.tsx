'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bot, Copy, Loader2, RefreshCw } from 'lucide-react';
import type { CopilotState } from '@pairux/meeting-copilot/types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-wide text-gray-500 uppercase">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-gray-800">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function CopilotReport({ id, header }: { id: string; header: ReactNode }) {
  const t = useTranslations('copilotPages');
  const c = useTranslations('copilot');
  const locale = useLocale();
  const [state, setState] = useState<CopilotState | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/copilot/${id}`);
    if (res.status === 401) {
      window.location.href = `/login?redirect=/copilot/${id}`;
      return;
    }
    const body = (await res.json()) as {
      data?: { copilot: CopilotState; title: string | null };
      error?: string;
    };
    if (!res.ok || !body.data) setError(body.error ?? t('loadError'));
    else {
      setState(body.data.copilot);
      setTitle(body.data.title);
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const rewrite = async (action: 'follow-ups' | 'review') => {
    setBusy(action);
    setError('');
    const res = await fetch(`/api/copilot/${id}/${action}`, { method: 'POST' });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) setError(body.error ?? t('loadError'));
    await load();
    setBusy('');
  };

  const notes = state?.notes;
  const review = state?.review;
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <Link href="/copilot" className="text-sm text-violet-700 hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Bot className="h-7 w-7 text-violet-600" aria-hidden="true" />
          {title ?? t('untitled')}
        </h1>
        {state && (
          <p className="mt-1 text-sm text-gray-500">
            {c(`roles.${state.role}.label`)} · {new Date(state.startedAt).toLocaleString(locale)}
            {state.status === 'live' && ` · ${t('live')}`}
            {state.providers.llm && ` · ${state.providers.llm}`}
          </p>
        )}
        {error && <p className="mt-6 text-red-600">{error}</p>}
        {!state && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}

        {notes && (
          <>
            {notes.summary && (
              <Section title={c('summary')}>
                <p className="text-gray-800">{notes.summary}</p>
              </Section>
            )}
            {notes.keyPoints.length > 0 && (
              <Section title={c('keyPoints')}>
                <Bullets items={notes.keyPoints} />
              </Section>
            )}
            {notes.decisions.length > 0 && (
              <Section title={c('decisions')}>
                <Bullets items={notes.decisions} />
              </Section>
            )}
            {notes.actionItems.length > 0 && (
              <Section title={c('actionItems')}>
                <Bullets
                  items={notes.actionItems.map((item) =>
                    item.owner ? `${item.text} (${c('owner', { owner: item.owner })})` : item.text
                  )}
                />
              </Section>
            )}
          </>
        )}
        {state && state.openQuestions.length > 0 && (
          <Section title={c('tabs.questions')}>
            <ul className="space-y-1 text-gray-800">
              {state.openQuestions.map((question) => (
                <li
                  key={question.id}
                  className={question.status === 'answered' ? 'text-gray-500' : ''}
                >
                  {question.status === 'answered' ? '✓ ' : '○ '}
                  {question.text}
                  {question.answer && <span className="text-gray-500"> → {question.answer}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {state && state.figures.length > 0 && (
          <Section title={c('figures')}>
            <div className="flex flex-wrap gap-2">
              {state.figures.map((figure) => (
                <span
                  key={figure.id}
                  className="rounded-lg bg-white px-2 py-1 text-sm text-gray-800 ring-1 ring-gray-200"
                >
                  <strong>{figure.value}</strong>
                  {figure.context && <span className="text-gray-500"> · {figure.context}</span>}
                </span>
              ))}
            </div>
          </Section>
        )}

        {state?.status === 'ended' && (
          <>
            <Section title={c('followUps')}>
              {state.followUps ? (
                <>
                  <Bullets
                    items={state.followUps.actionItems.map((item) =>
                      [item.text, item.owner && c('owner', { owner: item.owner }), item.due]
                        .filter(Boolean)
                        .join(' · ')
                    )}
                  />
                  {state.followUps.message && (
                    <div className="mt-3">
                      <p className="rounded-lg bg-white p-3 whitespace-pre-wrap text-gray-800 ring-1 ring-gray-200">
                        {state.followUps.message}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(state.followUps?.message ?? '')
                        }
                        className="mt-2 flex items-center gap-1 text-sm text-violet-700 hover:underline"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        {c('copy')}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500">{t('noFollowUps')}</p>
              )}
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void rewrite('follow-ups')}
                className="mt-3 flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-violet-300 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${busy === 'follow-ups' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {t('rewriteFollowUps')}
              </button>
            </Section>
            <Section title={c('review')}>
              {review ? (
                <div className="space-y-2 text-gray-800">
                  {review.thin ? (
                    <p className="text-gray-500">{c('thin')}</p>
                  ) : (
                    <>
                      {review.focusArea && (
                        <p>
                          <strong>{c('focusArea')}:</strong> {review.focusArea}
                        </p>
                      )}
                      <Bullets items={review.feedback} />
                      <p className="text-sm text-gray-500">
                        {c(`clarity.${review.followUpClarity}`)}
                      </p>
                    </>
                  )}
                  <p className="text-sm text-gray-500">
                    {c('talkListen', { you: Math.round(review.talkListen.you * 100) })} ·{' '}
                    {c('questionsResolved', {
                      answered: review.questions.answered,
                      asked: review.questions.asked,
                    })}
                  </p>
                  {review.note && !review.thin && (
                    <p className="text-sm text-gray-500">{review.note}</p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500">{t('noReview')}</p>
              )}
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void rewrite('review')}
                className="mt-3 flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-violet-300 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${busy === 'review' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {t('rewriteReview')}
              </button>
            </Section>
          </>
        )}

        {state && state.transcript.length > 0 && (
          <Section title={c('tabs.transcript')}>
            <div className="space-y-1 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
              {state.transcript.map((line) => (
                <p key={line.id}>
                  <span className="font-medium text-violet-700">{line.name}:</span> {line.text}
                </p>
              ))}
            </div>
          </Section>
        )}
      </main>
    </div>
  );
}
