'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CallAnalysisKind, CallAnalysisStatus } from '@pairux/shared-types';

interface AnalysisListItem {
  id: string;
  kind: CallAnalysisKind;
  title: string | null;
  status: CallAnalysisStatus;
  duration_seconds: number | null;
  created_at: string;
  headline: string | null;
  overallScore: number | null;
  error: string | null;
  mine?: boolean;
  team_id?: string | null;
  org_id?: string | null;
}

export function AnalysesList({ header }: { header: ReactNode }) {
  const t = useTranslations('analyses');
  const locale = useLocale();
  const [items, setItems] = useState<AnalysisListItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/analyses').then(async (res) => {
      if (res.status === 401) {
        window.location.href = '/login?redirect=/analyses';
        return;
      }
      const body = (await res.json()) as { data?: AnalysisListItem[]; error?: string };
      if (!res.ok) setError(body.error ?? t('list.loadError'));
      else setItems(body.data ?? []);
    });
  }, [t]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Sparkles className="h-7 w-7 text-violet-600" aria-hidden="true" />
          {t('list.title')}
        </h1>
        <p className="mt-2 text-gray-600">{t('list.intro')}</p>

        {error && <p className="mt-8 text-red-600">{error}</p>}
        {!items && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}
        {items?.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-600">
            {t.rich('list.empty', {
              link: (chunks) => (
                <Link href="/host" className="text-violet-700 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </div>
        )}
        <ul className="mt-8 space-y-3">
          {items?.map((item) => (
            <li key={item.id}>
              <Link
                href={`/analyses/${item.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-wide text-violet-700 uppercase">
                    {t(`kinds.${item.kind}`)} · {new Date(item.created_at).toLocaleString(locale)}
                  </p>
                  <p className="mt-1 truncate font-semibold text-gray-900">
                    {item.headline ?? item.title ?? t('list.untitled')}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {item.status === 'failed' && item.error
                      ? item.error
                      : t(`status.${item.status}`)}
                    {item.mine === false && ` · ${t('list.sharedWithTeam')}`}
                  </p>
                </div>
                {item.overallScore != null && (
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-lg font-bold text-violet-800">
                    {item.overallScore}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
