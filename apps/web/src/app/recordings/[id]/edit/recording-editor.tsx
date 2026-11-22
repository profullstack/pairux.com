'use client';

/**
 * Cut a cloud recording down to what matters: mark in/out on the timeline,
 * keep or cut the selection, fade the result in and out, put a title card or
 * another of your recordings before and after it, and render it on the
 * server. Same model as the desktop editor and `pairux edit`: a list of keep
 * ranges plus fades and bumpers (@pairux/video-edit).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Download,
  Eye,
  Loader2,
  Monitor,
  Plus,
  RotateCcw,
  Scissors,
  SquareDashed,
  Trash2,
} from 'lucide-react';
import {
  cutRange,
  formatTime,
  keptDuration,
  mergeRanges,
  parseTime,
  type Bumper,
  type KeepRange,
} from '@pairux/video-edit';
import { api, desktopEditLink, type RecordingItem } from '../../types';

const BTN =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';

type BumperChoice = 'none' | 'title' | 'recording';

interface BumperState {
  choice: BumperChoice;
  text: string;
  subtitle: string;
  duration: number;
  recordingId: string;
}

const emptyBumper = (text = ''): BumperState => ({
  choice: 'none',
  text,
  subtitle: '',
  duration: 3,
  recordingId: '',
});

function toBumper(b: BumperState): Bumper | null {
  if (b.choice === 'title' && b.text.trim())
    return {
      kind: 'title',
      text: b.text.trim(),
      subtitle: b.subtitle.trim() || undefined,
      duration: b.duration,
      fadeIn: 0.5,
      fadeOut: 0.5,
    };
  if (b.choice === 'recording' && b.recordingId)
    return { kind: 'file', source: `recording:${b.recordingId}`, fadeIn: 0.5, fadeOut: 0.5 };
  return null;
}

export function RecordingEditor({ id, header }: { id: string; header: ReactNode }) {
  const t = useTranslations('recordings.editor');
  const tp = useTranslations('recordings.publish');
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [recording, setRecording] = useState<RecordingItem | null>(null);
  const [others, setOthers] = useState<RecordingItem[]>([]);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [keep, setKeep] = useState<KeepRange[]>([]);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [previewCut, setPreviewCut] = useState(false);
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(1);
  const [intro, setIntro] = useState<BumperState>(emptyBumper());
  const [outro, setOutro] = useState<BumperState>(emptyBumper());
  const [subject, setSubject] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [edit, setEdit] = useState<RecordingItem | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [one, all] = await Promise.all([
          api<{ recording: RecordingItem }>(`/api/v1/recordings/${id}`),
          api<{ recordings: RecordingItem[] }>('/api/v1/recordings'),
        ]);
        setRecording(one.recording);
        setSubject(`${one.recording.subject ?? t('untitled')} (${t('editSuffix')})`);
        setIntro(emptyBumper(one.recording.subject ?? ''));
        setOutro(emptyBumper(t('thanks')));
        setOthers(all.recordings.filter((r) => r.status === 'ready' && r.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id, t]);

  const onLoaded = () => {
    const d = videoRef.current?.duration ?? 0;
    const known = Number.isFinite(d) && d > 0 ? d : (recording?.duration_seconds ?? 0);
    setDuration(known);
    if (known > 0) setKeep([{ start: 0, end: known }]);
  };

  // Preview the cut: skip over everything that is not kept.
  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    setTime(v.currentTime);
    if (!previewCut || v.paused || keep.length === 0) return;
    const now = v.currentTime;
    if (keep.some((r) => now >= r.start && now < r.end - 0.05)) return;
    const next = keep.find((r) => r.start > now);
    if (next) v.currentTime = next.start;
    else v.pause();
  };

  const seek = (s: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(duration, s));
  };

  const selection: KeepRange | null =
    markIn !== null && markOut !== null && markOut - markIn >= 0.1
      ? { start: markIn, end: markOut }
      : null;

  const keepOnlySelection = () => {
    if (selection) setKeep([selection]);
  };
  const addSelection = () => {
    if (selection) setKeep((k) => mergeRanges([...k, selection]));
  };
  const cutSelection = () => {
    if (selection) setKeep((k) => cutRange(k, selection.start, selection.end));
  };

  const setIn = useCallback(() => {
    const now = videoRef.current?.currentTime ?? 0;
    setMarkIn(now);
    setMarkOut((o) => (o !== null && o <= now ? null : o));
  }, []);
  const setOut = useCallback(() => {
    const now = videoRef.current?.currentTime ?? 0;
    setMarkOut(now);
    setMarkIn((i) => (i !== null && i >= now ? null : i));
  }, []);

  // I / O mark in and out, like every editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === 'i' || e.key === 'I') setIn();
      if (e.key === 'o' || e.key === 'O') setOut();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [setIn, setOut]);

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  const updateRange = (index: number, field: 'start' | 'end', value: string) => {
    let seconds: number;
    try {
      seconds = parseTime(value);
    } catch {
      return;
    }
    setKeep((k) => {
      const next = k.map((r, i) => (i === index ? { ...r, [field]: seconds } : r));
      return mergeRanges(next.filter((r) => r.end - r.start >= 0.1));
    });
  };

  const kept = keptDuration(keep);
  const maxFade = Math.min(5, kept / 2);
  const pct = (s: number) => `${String(duration > 0 ? (s / duration) * 100 : 0)}%`;

  const plan = useMemo(
    () => ({
      keep,
      fadeIn: Math.min(fadeIn, maxFade),
      fadeOut: Math.min(fadeOut, maxFade),
      intro: toBumper(intro),
      outro: toBumper(outro),
    }),
    [keep, fadeIn, fadeOut, maxFade, intro, outro]
  );

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const data = await api<{ recording: RecordingItem }>(`/api/v1/recordings/${id}/edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, subject }),
      });
      setEdit(data.recording);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Poll the render.
  const editId = edit?.id;
  const editStatus = edit?.status;
  useEffect(() => {
    if (!editId || editStatus !== 'processing') return;
    const timer = setInterval(() => {
      void api<{ recording: RecordingItem }>(`/api/v1/recordings/${editId}`)
        .then((d) => {
          setEdit(d.recording);
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [editId, editStatus]);

  const bumperFields = (
    label: string,
    state: BumperState,
    set: (b: BumperState) => void
  ): ReactNode => (
    <fieldset className="rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-sm font-semibold text-gray-800">{label}</legend>
      <select
        value={state.choice}
        onChange={(e) => {
          set({ ...state, choice: e.target.value as BumperChoice });
        }}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      >
        <option value="none">{t('bumper.none')}</option>
        <option value="title">{t('bumper.title')}</option>
        <option value="recording" disabled={others.length === 0}>
          {t('bumper.recording')}
        </option>
      </select>
      {state.choice === 'title' && (
        <div className="mt-2 space-y-2">
          <input
            value={state.text}
            maxLength={120}
            onChange={(e) => {
              set({ ...state, text: e.target.value });
            }}
            placeholder={t('bumper.textPlaceholder')}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={state.subtitle}
            maxLength={120}
            onChange={(e) => {
              set({ ...state, subtitle: e.target.value });
            }}
            placeholder={t('bumper.subtitlePlaceholder')}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            {t('bumper.seconds')}
            <input
              type="number"
              min={1}
              max={15}
              step={0.5}
              value={state.duration}
              onChange={(e) => {
                set({ ...state, duration: Math.min(15, Math.max(1, Number(e.target.value) || 3)) });
              }}
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
      {state.choice === 'recording' && (
        <select
          value={state.recordingId}
          onChange={(e) => {
            set({ ...state, recordingId: e.target.value });
          }}
          className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">{t('bumper.pick')}</option>
          {others.map((r) => (
            <option key={r.id} value={r.id}>
              {(r.subject ?? t('untitled')) +
                (r.duration_seconds ? ` (${formatTime(r.duration_seconds, 0)})` : '')}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Link
          href="/recordings"
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('back')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{t('title')}</h1>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {!recording && !error && (
          <p className="mt-10 flex items-center gap-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('loading')}
          </p>
        )}

        {recording && !recording.playback_url && (
          <p className="mt-6 text-gray-600">{t('notReady')}</p>
        )}

        {recording?.playback_url && (
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <section className="space-y-4 lg:col-span-2">
              <video
                ref={videoRef}
                src={recording.playback_url}
                controls
                preload="metadata"
                onLoadedMetadata={onLoaded}
                onTimeUpdate={onTime}
                className="aspect-video w-full rounded-xl bg-black"
              />

              {/* Timeline: kept ranges, selection, playhead. Click to seek. */}
              <div>
                <div
                  ref={barRef}
                  onClick={onBarClick}
                  role="presentation"
                  className="relative h-10 cursor-pointer overflow-hidden rounded-md bg-gray-200"
                >
                  {keep.map((r, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 bg-indigo-400/80"
                      style={{ left: pct(r.start), width: pct(r.end - r.start) }}
                    />
                  ))}
                  {selection && (
                    <div
                      className="absolute inset-y-1 rounded border-2 border-amber-500 bg-amber-300/30"
                      style={{
                        left: pct(selection.start),
                        width: pct(selection.end - selection.start),
                      }}
                    />
                  )}
                  {markIn !== null && !selection && (
                    <div
                      className="absolute inset-y-0 w-0.5 bg-amber-600"
                      style={{ left: pct(markIn) }}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 w-0.5 bg-gray-900"
                    style={{ left: pct(time) }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>{formatTime(time)}</span>
                  <span>
                    {t('keptOf', { kept: formatTime(kept, 0), total: formatTime(duration, 0) })}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={setIn} className={BTN}>
                  {t('markIn')} {markIn !== null ? formatTime(markIn) : ''}
                </button>
                <button type="button" onClick={setOut} className={BTN}>
                  {t('markOut')} {markOut !== null ? formatTime(markOut) : ''}
                </button>
                <button
                  type="button"
                  disabled={!selection}
                  onClick={keepOnlySelection}
                  className={BTN}
                >
                  <SquareDashed className="h-4 w-4" aria-hidden="true" />
                  {t('keepOnly')}
                </button>
                <button type="button" disabled={!selection} onClick={addSelection} className={BTN}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('addSelection')}
                </button>
                <button type="button" disabled={!selection} onClick={cutSelection} className={BTN}>
                  <Scissors className="h-4 w-4" aria-hidden="true" />
                  {t('cutSelection')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setKeep(duration > 0 ? [{ start: 0, end: duration }] : []);
                    setMarkIn(null);
                    setMarkOut(null);
                  }}
                  className={BTN}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t('reset')}
                </button>
                <label className="ml-auto flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={previewCut}
                    onChange={(e) => {
                      setPreviewCut(e.target.checked);
                    }}
                  />
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  {t('previewCut')}
                </label>
              </div>
              <p className="text-xs text-gray-500">{t('shortcuts')}</p>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-800">{t('ranges')}</h2>
                {keep.length === 0 && (
                  <p className="mt-2 text-sm text-red-600">{t('nothingKept')}</p>
                )}
                <ul className="mt-2 space-y-2">
                  {keep.map((r, i) => (
                    <li
                      key={`${String(r.start)}-${String(r.end)}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        defaultValue={formatTime(r.start)}
                        onBlur={(e) => {
                          updateRange(i, 'start', e.target.value);
                        }}
                        aria-label={t('start')}
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 font-mono"
                      />
                      <span>–</span>
                      <input
                        defaultValue={formatTime(r.end)}
                        onBlur={(e) => {
                          updateRange(i, 'end', e.target.value);
                        }}
                        aria-label={t('end')}
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          seek(r.start);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        {t('jump')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setKeep((k) => k.filter((_, j) => j !== i));
                        }}
                        aria-label={t('removeRange')}
                        className="ml-auto text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <label className="block text-sm font-semibold text-gray-800">
                  {t('name')}
                  <input
                    value={subject}
                    maxLength={200}
                    onChange={(e) => {
                      setSubject(e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal"
                  />
                </label>
                {(['fadeIn', 'fadeOut'] as const).map((key) => {
                  const value = key === 'fadeIn' ? fadeIn : fadeOut;
                  const set = key === 'fadeIn' ? setFadeIn : setFadeOut;
                  return (
                    <label key={key} className="mt-3 block text-sm text-gray-700">
                      {t(key, { seconds: Math.min(value, maxFade).toFixed(1) })}
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={value}
                        onChange={(e) => {
                          set(Number(e.target.value));
                        }}
                        className="mt-1 w-full"
                      />
                    </label>
                  );
                })}
              </div>

              {bumperFields(t('intro'), intro, setIntro)}
              {bumperFields(t('outro'), outro, setOutro)}

              {!edit && (
                <button
                  type="button"
                  disabled={submitting || keep.length === 0}
                  onClick={() => void submit()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t('render')}
                </button>
              )}

              {edit && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm">
                  {edit.status === 'processing' && (
                    <>
                      <p className="font-medium text-indigo-900">
                        {t('rendering', { percent: Math.round((edit.edit_progress ?? 0) * 100) })}
                      </p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                        <div
                          className="h-full bg-indigo-500 transition-all"
                          style={{
                            width: `${String(Math.round((edit.edit_progress ?? 0) * 100))}%`,
                          }}
                        />
                      </div>
                    </>
                  )}
                  {edit.status === 'ready' && edit.playback_url && (
                    <div className="space-y-2">
                      <p className="font-medium text-indigo-900">{t('done')}</p>
                      <a
                        href={edit.playback_url}
                        download
                        className="inline-flex items-center gap-1.5 text-indigo-700 hover:underline"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        {t('download')}
                      </a>
                      <div>
                        <Link
                          href={`/recordings/${edit.id}/edit`}
                          className="text-indigo-700 hover:underline"
                        >
                          {t('editAgain')}
                        </Link>
                      </div>
                    </div>
                  )}
                  {edit.status === 'failed' && (
                    <div className="space-y-2">
                      <p className="text-red-700">
                        {t('failed')}
                        {edit.edit_error ? `: ${edit.edit_error}` : ''}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setEdit(null);
                        }}
                        className="text-indigo-700 hover:underline"
                      >
                        {t('tryAgain')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
                <p className="font-semibold text-gray-800">{t('desktop.title')}</p>
                <p className="mt-1">{t('desktop.body')}</p>
                <a
                  href={desktopEditLink(
                    edit?.playback_url ?? recording.playback_url,
                    recording.subject
                  )}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  {t('desktop.open')}
                </a>
                <Link
                  href={`/recordings/${edit?.status === 'ready' ? edit.id : recording.id}/publish`}
                  className="mt-3 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
                >
                  {tp('listAction')}
                </Link>
                <p className="mt-2 text-xs text-gray-500">
                  {t('desktop.cli')}{' '}
                  <code className="rounded bg-gray-100 px-1">pairux edit --publish c0mpute</code>
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
