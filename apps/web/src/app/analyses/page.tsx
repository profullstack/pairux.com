'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Sparkles } from 'lucide-react';
import { HeaderClient } from '@/components/header-client';
import { ANALYSIS_KIND_LABELS } from '@/components/session/CallAnalysisOptions';
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
}

const STATUS_TEXT: Record<CallAnalysisStatus, string> = {
  recording: 'Recording',
  queued: 'Waiting to be analysed',
  processing: 'Writing your report',
  ready: 'Ready',
  failed: 'Failed',
};

export default function AnalysesPage() {
  const [items, setItems] = useState<AnalysisListItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/analyses').then(async (res) => {
      if (res.status === 401) {
        window.location.href = '/login?redirect=/analyses';
        return;
      }
      const body = (await res.json()) as { data?: AnalysisListItem[]; error?: string };
      if (!res.ok) setError(body.error ?? 'Could not load your analyses');
      else setItems(body.data ?? []);
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <HeaderClient user={null} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
          <Sparkles className="h-7 w-7 text-violet-600" aria-hidden="true" />
          Call analyses
        </h1>
        <p className="mt-2 text-gray-600">
          Feedback on the calls you ran with AI analysis on. Turn it on before a call from the start
          screen on the web, desktop or mobile app.
        </p>

        {error && <p className="mt-8 text-red-600">{error}</p>}
        {!items && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}
        {items?.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-600">
            No analysed calls yet.{' '}
            <Link href="/host" className="text-violet-700 hover:underline">
              Start a call with AI analysis
            </Link>
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
                    {ANALYSIS_KIND_LABELS[item.kind]} · {new Date(item.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 truncate font-semibold text-gray-900">
                    {item.headline ?? item.title ?? 'Untitled call'}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {item.status === 'failed' && item.error ? item.error : STATUS_TEXT[item.status]}
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
