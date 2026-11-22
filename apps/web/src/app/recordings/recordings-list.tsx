'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Film, Loader2, Lock, Pencil, Scissors, Trash2 } from 'lucide-react';
import { formatTime } from '@pairux/video-edit';
import { api, formatBytes, type RecordingItem } from './types';

export function RecordingsList({ header }: { header: ReactNode }) {
  const t = useTranslations('recordings');
  const locale = useLocale();
  const [items, setItems] = useState<RecordingItem[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<{ recordings: RecordingItem[] }>('/api/v1/recordings');
      setItems(data.recordings);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('list.loadError'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while an edit renders.
  const rendering = items?.some((r) => r.status === 'processing' && r.parent_recording_id) ?? false;
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void load(), 3000);
    return () => {
      clearInterval(timer);
    };
  }, [rendering, load]);

  const remove = async (id: string) => {
    if (!window.confirm(t('list.confirmDelete'))) return;
    try {
      await api(`/api/v1/recordings/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Film className="h-7 w-7 text-indigo-600" aria-hidden="true" />
          {t('list.title')}
        </h1>
        <p className="mt-2 text-gray-600">{t('list.intro')}</p>

        {error && (
          <p role="alert" className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {items === null && !error && (
          <p className="mt-10 flex items-center gap-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('list.loading')}
          </p>
        )}

        {items?.length === 0 && (
          <p className="mt-10 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            {t('list.empty')}
          </p>
        )}

        <ul className="mt-8 space-y-3">
          {items?.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-gray-900">
                    {r.parent_recording_id && (
                      <Scissors
                        className="h-4 w-4 shrink-0 text-indigo-500"
                        aria-label={t('list.edit')}
                      />
                    )}
                    <span className="truncate">{r.subject ?? t('list.untitled')}</span>
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {new Date(r.created_at).toLocaleString(locale)}
                    {r.duration_seconds ? ` · ${formatTime(r.duration_seconds, 0)}` : ''}
                    {r.size_bytes ? ` · ${formatBytes(r.size_bytes)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === 'ready' && r.playback_url && (
                    <>
                      <Link
                        href={`/recordings/${r.id}/edit`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        {t('list.editButton')}
                      </Link>
                      <a
                        href={r.playback_url}
                        download
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        {t('list.download')}
                      </a>
                      <Link
                        href={`/recordings/${r.id}/publish`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Lock className="h-4 w-4" aria-hidden="true" />
                        {t('publish.listAction')}
                      </Link>
                    </>
                  )}
                  {r.parent_recording_id && r.status !== 'processing' && (
                    <button
                      type="button"
                      onClick={() => void remove(r.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t('list.delete')}
                    </button>
                  )}
                </div>
              </div>
              {r.status === 'processing' && r.parent_recording_id && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${String(Math.round((r.edit_progress ?? 0) * 100))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('list.rendering', { percent: Math.round((r.edit_progress ?? 0) * 100) })}
                  </p>
                </div>
              )}
              {r.status === 'recording' && (
                <p className="mt-2 text-sm text-gray-500">{t('list.stillRecording')}</p>
              )}
              {r.status === 'processing' && !r.parent_recording_id && (
                <p className="mt-2 text-sm text-gray-500">{t('list.finishing')}</p>
              )}
              {r.status === 'failed' && (
                <p className="mt-2 text-sm text-red-600">
                  {t('list.failed')}
                  {r.edit_error ? `: ${r.edit_error}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
