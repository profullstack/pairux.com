'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bot, Loader2, Settings, Users } from 'lucide-react';

interface CopilotListItem {
  id: string;
  sessionId: string;
  role: string;
  status: string;
  title: string | null;
  summary: string;
  startedAt: string;
}

export function CopilotList({ header }: { header: ReactNode }) {
  const t = useTranslations('copilotPages');
  const roles = useTranslations('copilot.roles');
  const locale = useLocale();
  const [items, setItems] = useState<CopilotListItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/copilot').then(async (res) => {
      if (res.status === 401) {
        window.location.href = '/login?redirect=/copilot';
        return;
      }
      const body = (await res.json()) as { data?: { copilots: CopilotListItem[] }; error?: string };
      if (!res.ok) setError(body.error ?? t('loadError'));
      else setItems(body.data?.copilots ?? []);
    });
  }, [t]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <div className="flex items-start justify-between gap-4">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900">
            <Bot className="h-7 w-7 text-violet-600" aria-hidden="true" />
            {t('listTitle')}
          </h1>
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href="/settings/agents"
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-violet-300"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              {t('agents.link')}
            </Link>
            <Link
              href="/settings/copilot"
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-violet-300"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              {t('settingsLink')}
            </Link>
          </div>
        </div>
        <p className="mt-2 text-gray-600">{t('listIntro')}</p>
        {error && <p className="mt-8 text-red-600">{error}</p>}
        {!items && !error && <Loader2 className="mt-12 h-6 w-6 animate-spin text-gray-400" />}
        {items?.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-600">
            {t('empty')}
          </div>
        )}
        <ul className="mt-8 space-y-3">
          {items?.map((item) => (
            <li key={item.id}>
              <Link
                href={`/copilot/${item.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-300"
              >
                <p className="text-xs font-medium tracking-wide text-violet-700 uppercase">
                  {roles.has(`${item.role}.label`) ? roles(`${item.role}.label`) : item.role} ·{' '}
                  {new Date(item.startedAt).toLocaleString(locale)}
                  {item.status === 'live' && ` · ${t('live')}`}
                </p>
                <p className="mt-1 truncate font-semibold text-gray-900">
                  {item.title ?? t('untitled')}
                </p>
                {item.summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-gray-600">{item.summary}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
