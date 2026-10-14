'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, Users, Clock, ExternalLink, Loader2 } from 'lucide-react';

interface Session {
  id: string;
  join_code: string;
  status: 'created' | 'active' | 'paused' | 'ended';
  created_at: string;
  ended_at: string | null;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  participant_count?: number;
}

interface SessionsResponse {
  data?: Session[];
  error?: string;
}

type Translate = ReturnType<typeof useTranslations<'dashboard.recentSessions'>>;

function formatDuration(t: Translate, startDate: string, endDate: string | null): string {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return t('duration.underMinute');
  if (diffMins < 60) return t('duration.minutes', { minutes: diffMins });
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0
    ? t('duration.hoursMinutes', { hours, minutes: mins })
    : t('duration.hours', { hours });
}

function formatDate(t: Translate, locale: string, dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('date.today');
  if (diffDays === 1) return t('date.yesterday');
  if (diffDays < 7) return t('date.daysAgo', { days: diffDays });

  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function getStatusBadge(t: Translate, status: Session['status']) {
  const styles = {
    created: 'bg-yellow-100 text-yellow-700',
    active: 'bg-green-100 text-green-700',
    paused: 'bg-orange-100 text-orange-700',
    ended: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

export function RecentSessions() {
  const t = useTranslations('dashboard.recentSessions');
  const locale = useLocale();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const response = await fetch('/api/sessions?limit=5');
        const result = (await response.json()) as SessionsResponse;

        if (!response.ok) {
          throw new Error(result.error ?? t('fetchFailed'));
        }

        setSessions(result.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('loadFailed'));
      } finally {
        setIsLoading(false);
      }
    }

    void fetchSessions();
  }, [t]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <div className="mt-4 flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-8 text-center">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => {
              window.location.reload();
            }}
            className="mt-2 text-sm text-gray-500 hover:text-gray-700"
          >
            {t('tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
          <Monitor className="h-12 w-12 text-gray-300" />
          <p className="mt-4 text-gray-500">{t('empty')}</p>
          <p className="text-sm text-gray-400">{t('emptyHint')}</p>
          <Link
            href="/host"
            className="bg-primary-600 hover:bg-primary-700 mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            {t('startSession')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <Link
          href="/sessions"
          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
        >
          {t('viewAll')}
        </Link>
      </div>
      <div className="mt-4 divide-y divide-gray-100">
        {sessions.map((session) => (
          <div key={session.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="bg-primary-50 flex h-10 w-10 items-center justify-center rounded-lg">
                <Monitor className="text-primary-600 h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-gray-900">
                    {session.join_code}
                  </span>
                  {getStatusBadge(t, session.status)}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(t, session.created_at, session.ended_at)}
                  </span>
                  {session.participant_count !== undefined && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {session.participant_count}
                    </span>
                  )}
                  <span>{formatDate(t, locale, session.created_at)}</span>
                </div>
              </div>
            </div>
            {session.status !== 'ended' && (
              /* A live session is already being hosted somewhere — join it as a
                 participant. Opening host mode would try to take over as
                 publisher, which on a phone means blacking out the machine that
                 is actually sharing. Resuming only makes sense when dormant. */
              <Link
                href={
                  session.status === 'active' ? `/session/${session.id}` : `/host/${session.id}`
                }
                className="text-primary-600 hover:text-primary-700 flex items-center gap-1 text-sm font-medium"
              >
                {session.status === 'active' ? t('join') : t('resume')}
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
