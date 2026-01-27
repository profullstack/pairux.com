'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

function formatDuration(startDate: string, endDate: string | null): string {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return '< 1 min';
  if (diffMins < 60) return `${String(diffMins)} min`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${String(hours)}h ${String(mins)}m` : `${String(hours)}h`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${String(diffDays)} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getStatusBadge(status: Session['status']) {
  const styles = {
    created: 'bg-yellow-100 text-yellow-700',
    active: 'bg-green-100 text-green-700',
    paused: 'bg-orange-100 text-orange-700',
    ended: 'bg-gray-100 text-gray-600',
  };

  const labels = {
    created: 'Created',
    active: 'Active',
    paused: 'Paused',
    ended: 'Ended',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export function RecentSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const response = await fetch('/api/sessions?limit=5');
        const result = (await response.json()) as SessionsResponse;

        if (!response.ok) {
          throw new Error(result.error ?? 'Failed to fetch sessions');
        }

        setSessions(result.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setIsLoading(false);
      }
    }

    void fetchSessions();
  }, []);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recent Sessions</h2>
        <div className="mt-4 flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recent Sessions</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-8 text-center">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => {
              window.location.reload();
            }}
            className="mt-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recent Sessions</h2>
        <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
          <Monitor className="h-12 w-12 text-gray-300" />
          <p className="mt-4 text-gray-500">No sessions yet</p>
          <p className="text-sm text-gray-400">Start your first session to see it here</p>
          <Link
            href="/host"
            className="bg-primary-600 hover:bg-primary-700 mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Start Session
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Recent Sessions</h2>
        <Link
          href="/sessions"
          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
        >
          View all
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
                  {getStatusBadge(session.status)}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(session.created_at, session.ended_at)}
                  </span>
                  {session.participant_count !== undefined && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {session.participant_count}
                    </span>
                  )}
                  <span>{formatDate(session.created_at)}</span>
                </div>
              </div>
            </div>
            {session.status !== 'ended' && (
              <Link
                href={`/host/${session.id}`}
                className="text-primary-600 hover:text-primary-700 flex items-center gap-1 text-sm font-medium"
              >
                Resume
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
