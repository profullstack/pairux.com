'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Sparkles, ThumbsUp, Target, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CallAnalysisKind, CallAnalysisStatus } from '@pairux/shared-types';
import type { CallReport } from '@/lib/call-analysis/report';
import { formatClock, type CallMetrics, type TranscriptSegment } from '@/lib/call-analysis/metrics';

interface AnalysisDetail {
  id: string;
  kind: CallAnalysisKind;
  title: string | null;
  status: CallAnalysisStatus;
  source: 'web' | 'desktop' | 'mobile';
  duration_seconds: number | null;
  created_at: string;
  error: string | null;
  report: (CallReport & { generatedBy?: string }) | null;
  metrics: CallMetrics | null;
  transcript: TranscriptSegment[] | null;
  recordingUrl: string | null;
}

function At({ ms, onSeek }: { ms: number | null; onSeek: (ms: number) => void }) {
  if (ms == null) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onSeek(ms);
      }}
      className="ml-2 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 text-xs text-gray-600 hover:bg-violet-100"
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      {formatClock(ms)}
    </button>
  );
}

export function AnalysisReport({ id, header }: { id: string; header: ReactNode }) {
  const t = useTranslations('analyses');
  const locale = useLocale();
  const [data, setData] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const res = await fetch(`/api/analyses/${id}`);
      if (res.status === 401) {
        window.location.href = `/login?redirect=/analyses/${id}`;
        return;
      }
      const body = (await res.json()) as { data?: AnalysisDetail; error?: string };
      if (!res.ok || !body.data) {
        setError(body.error ?? t('report.loadError'));
        return;
      }
      setData(body.data);
      // Keep checking while the report is still being made.
      if (['recording', 'queued', 'processing'].includes(body.data.status)) {
        timer = setTimeout(() => void load(), 15_000);
      }
    };
    void load();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [id, t]);

  const seek = (ms: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = ms / 1000;
      void mediaRef.current.play();
    }
  };

  const report = data?.report ?? null;
  const metrics = data?.metrics ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <Link href="/analyses" className="text-sm text-violet-700 hover:underline">
          {t('report.back')}
        </Link>
        {error && <p className="mt-8 text-red-600">{error}</p>}
        {!data && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}

        {data && !report && (
          <div className="mt-8 rounded-xl border border-gray-200 bg-white p-8 text-center">
            {data.status === 'failed' ? (
              <p className="text-red-600">{t('report.failed', { error: data.error ?? '' })}</p>
            ) : (
              <>
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-violet-500" />
                <p className="mt-4 text-gray-700">
                  {data.status === 'recording'
                    ? t('report.stillRecording')
                    : t('report.beingWritten')}
                </p>
              </>
            )}
          </div>
        )}

        {data && report && (
          <article className="mt-6 space-y-8">
            <header className="rounded-2xl bg-gradient-to-br from-violet-700 to-indigo-700 p-8 text-white">
              <p className="text-sm font-medium text-violet-200 uppercase">
                {t(`kinds.${data.kind}`)}
                {data.title ? ` · ${data.title}` : ''} ·{' '}
                {new Date(data.created_at).toLocaleString(locale)}
              </p>
              <div className="mt-3 flex items-start justify-between gap-6">
                <h1 className="text-3xl font-bold">{report.headline}</h1>
                <div className="flex-shrink-0 text-center">
                  <div className="text-5xl font-bold">{report.overallScore}</div>
                  <div className="text-xs text-violet-200">{t('report.outOf10')}</div>
                </div>
              </div>
              <p className="mt-4 text-violet-50">{report.summary}</p>
            </header>

            {data.recordingUrl && (
              <audio
                ref={(el) => {
                  mediaRef.current = el;
                }}
                src={data.recordingUrl}
                controls
                className="w-full"
              />
            )}

            {metrics && (
              <section>
                <h2 className="text-xl font-semibold text-gray-900">{t('report.byTheNumbers')}</h2>
                <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-2">{t('report.table.speaker')}</th>
                        <th className="px-4 py-2">{t('report.table.talkTime')}</th>
                        <th className="px-4 py-2">{t('report.table.pace')}</th>
                        <th className="px-4 py-2">{t('report.table.fillers')}</th>
                        <th className="px-4 py-2">{t('report.table.questions')}</th>
                        <th className="px-4 py-2">{t('report.table.longestTurn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.speakers.map((s) => (
                        <tr key={s.speaker} className="border-t border-gray-100">
                          <td className="px-4 py-2 font-medium text-gray-900">
                            {s.speaker}
                            <span className="block text-xs font-normal text-gray-500">
                              {report.speakers.find((r) => r.label === s.speaker)?.role}
                            </span>
                          </td>
                          <td className="px-4 py-2">{s.talkShare}%</td>
                          <td className="px-4 py-2">
                            {t('report.table.wpm', { value: s.wordsPerMinute })}
                          </td>
                          <td className="px-4 py-2">
                            {t('report.table.fillerRate', { value: s.fillerRate })}
                          </td>
                          <td className="px-4 py-2">{s.questions}</td>
                          <td className="px-4 py-2">{formatClock(s.longestTurnMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.source === 'mobile' && (
                  <p className="mt-2 text-xs text-gray-500">{t('report.mobileNote')}</p>
                )}
              </section>
            )}

            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-green-200 bg-white p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <ThumbsUp className="h-5 w-5 text-green-600" aria-hidden="true" />{' '}
                  {t('report.whatWorked')}
                </h2>
                <ul className="mt-4 space-y-4">
                  {report.strengths.map((p) => (
                    <li key={p.title}>
                      <p className="font-medium text-gray-900">
                        {p.title}
                        <At ms={p.atMs} onSeek={seek} />
                      </p>
                      <p className="mt-1 text-sm text-gray-600">{p.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-amber-200 bg-white p-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <Target className="h-5 w-5 text-amber-600" aria-hidden="true" />{' '}
                  {t('report.toImprove')}
                </h2>
                <ul className="mt-4 space-y-4">
                  {report.improvements.map((p) => (
                    <li key={p.title}>
                      <p className="font-medium text-gray-900">
                        {p.title}
                        <At ms={p.atMs} onSeek={seek} />
                      </p>
                      <p className="mt-1 text-sm text-gray-600">{p.detail}</p>
                      <p className="mt-1 text-sm text-amber-800">
                        {t('report.try', { suggestion: p.suggestion })}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900">{report.focus.title}</h2>
              <ul className="mt-4 space-y-4">
                {report.focus.points.map((p) => (
                  <li key={p.title}>
                    <p className="font-medium text-gray-900">
                      {p.title}
                      <At ms={p.atMs} onSeek={seek} />
                    </p>
                    <p className="mt-1 text-sm text-gray-600">{p.detail}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('report.delivery.title')}
                </h2>
                <dl className="mt-4 space-y-3 text-sm">
                  {(
                    [
                      ['pace', report.delivery.pace],
                      ['clarity', report.delivery.clarity],
                      ['confidence', report.delivery.confidence],
                      ['fillerWords', report.delivery.fillerWords],
                      ['listening', report.delivery.listening],
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label}>
                      <dt className="font-medium text-gray-900">{t(`report.delivery.${label}`)}</dt>
                      <dd className="text-gray-600">{text}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">{t('report.practiceNext')}</h2>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-gray-700">
                  {report.practiceNext.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
                {report.visuals && (
                  <>
                    <h3 className="mt-6 font-semibold text-gray-900">{t('report.onScreen')}</h3>
                    <p className="mt-1 text-sm text-gray-600">{report.visuals.summary}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                      {report.visuals.suggestions.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>

            {(report.actionItems.length > 0 || report.keyMoments.length > 0) && (
              <section className="grid gap-6 md:grid-cols-2">
                {report.actionItems.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-6">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {t('report.actionItems')}
                    </h2>
                    <ul className="mt-4 space-y-2 text-sm text-gray-700">
                      {report.actionItems.map((a) => (
                        <li key={a.task}>
                          {a.task}
                          {a.owner ? <span className="text-gray-500"> ({a.owner})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.keyMoments.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-6">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {t('report.keyMoments')}
                    </h2>
                    <ul className="mt-4 space-y-2 text-sm text-gray-700">
                      {report.keyMoments.map((m) => (
                        <li key={`${String(m.atMs)}-${m.label}`}>
                          {m.label}
                          <At ms={m.atMs} onSeek={seek} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {data.transcript && (
              <section>
                <button
                  type="button"
                  onClick={() => {
                    setShowTranscript((v) => !v);
                  }}
                  className="text-sm font-medium text-violet-700 hover:underline"
                >
                  {showTranscript ? t('report.hideTranscript') : t('report.showTranscript')}
                </button>
                {showTranscript && (
                  <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 text-sm">
                    {data.transcript.map((s) => (
                      <p key={`${String(s.startMs)}-${s.speaker ?? ''}`}>
                        <button
                          type="button"
                          onClick={() => {
                            seek(s.startMs);
                          }}
                          className="mr-2 text-xs text-gray-400 hover:text-violet-700"
                        >
                          {formatClock(s.startMs)}
                        </button>
                        {s.speaker && (
                          <span className="font-medium text-gray-900">{s.speaker}: </span>
                        )}
                        <span className="text-gray-700">{s.text}</span>
                      </p>
                    ))}
                  </div>
                )}
              </section>
            )}

            <p className="flex items-center gap-2 text-xs text-gray-500">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {report.generatedBy
                ? t('report.disclaimerWithModel', { model: report.generatedBy })
                : t('report.disclaimer')}
            </p>
          </article>
        )}
      </main>
    </div>
  );
}
