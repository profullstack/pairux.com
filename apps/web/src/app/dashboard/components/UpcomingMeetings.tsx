'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Calendar,
  Users,
  Clock,
  Play,
  Pencil,
  Trash2,
  Loader2,
  CalendarPlus,
  CheckCircle,
  Repeat,
  Radio,
} from 'lucide-react';
import { buildGoogleCalendarUrl, buildOutlookUrl, downloadIcs } from '@/lib/calendar';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';
import { DesktopHandoffOverlay } from '@/components/session/DesktopHandoffOverlay';
import { useDesktopHandoff } from '@/hooks/useDesktopHandoff';
import { occurrencesRemaining, ruleFromRow } from '@/lib/recurrence';
import { describeRecurrenceText, shortRecurrenceText } from './recurrenceText';
import { isScheduledMeetingCurrent } from '@/lib/scheduled-meeting-timing';

interface Invitee {
  id: string;
  email: string;
  name: string | null;
  rsvp_status: string;
}

interface ScheduledSession {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  join_code: string;
  status: string;
  invitee_count: number;
  invitees: Invitee[];
  recurrence_freq?: string | null;
  recurrence_interval?: number | null;
  recurrence_count?: number | null;
  occurrences_elapsed?: number | null;
  channel_id?: string | null;
  /** The channel this meeting broadcasts on when it goes live. */
  channel?: { handle: string; name: string } | null;
}

interface ListResponse {
  data?: ScheduledSession[];
  error?: string;
}

interface StartResponse {
  data?: { session: { id: string; join_code: string }; joinCode: string; notified: number };
  error?: string;
}

type Translate = ReturnType<typeof useTranslations<'dashboard.upcoming'>>;
type MeetingsTranslate = ReturnType<typeof useTranslations<'meetings'>>;

function formatDate(t: Translate, locale: string, isoString: string, nowMs: number): string {
  const date = new Date(isoString);
  const now = new Date(nowMs);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const timeStr = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return t('todayAt', { time: timeStr });
  if (date.toDateString() === tomorrow.toDateString()) return t('tomorrowAt', { time: timeStr });
  if (date.getTime() - nowMs < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(locale, {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Weekly", or "Weekly · 3 left" once a series has a finite number of dates left. */
function repeatLabel(tm: MeetingsTranslate, session: ScheduledSession): string | null {
  const short = shortRecurrenceText(tm, ruleFromRow(session));
  if (!short) return null;

  const left = occurrencesRemaining(
    session.recurrence_count ?? 0,
    session.occurrences_elapsed ?? 0
  );
  return left === null ? short : tm('recurrence.shortWithLeft', { label: short, left });
}

interface Props {
  onSchedule: () => void;
}

export function UpcomingMeetings({ onSchedule }: Props) {
  const t = useTranslations('dashboard.upcoming');
  const tm = useTranslations('meetings');
  const locale = useLocale();
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [calendarOpenId, setCalendarOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledSession | null>(null);
  // Starting a meeting belongs in the desktop app, which is the only place a
  // guest can be handed control; the web player is the fallback.
  const handoff = useDesktopHandoff();
  const [startError, setStartError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled-sessions?filter=upcoming');
      const json = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(json.error ?? t('loadFailed'));
      setSessions(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  async function handleStart(session: ScheduledSession) {
    setStartingId(session.id);
    setStartError(null);
    try {
      // One endpoint rather than a bare session create: it ties the room to the
      // meeting and mails the guest list, and a second click adopts the room
      // that already exists instead of colliding on the join code.
      const res = await fetch(`/api/scheduled-sessions/${session.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = (await res.json().catch(() => ({}))) as StartResponse;
      if (res.ok && json.data?.session.id) {
        handoff.openSession(json.data.session.id);
        return;
      }
      throw new Error(json.error ?? t('startFailed'));
    } catch (err) {
      setStartError(err instanceof Error ? err.message : t('startFailed'));
    } finally {
      setStartingId(null);
    }
  }

  const currentSessions = sessions.filter((session) => isScheduledMeetingCurrent(session, nowMs));

  async function handleCancel(id: string) {
    if (!confirm(t('cancelConfirm'))) return;
    setCancellingId(id);
    try {
      await fetch(`/api/scheduled-sessions/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setCancellingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <div className="mt-4 flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <p className="mt-3 text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <DesktopHandoffOverlay
        state={handoff.state}
        onContinueInBrowser={handoff.continueInBrowser}
      />

      {editing && (
        <ScheduleMeetingModal
          meeting={editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            void fetchSessions();
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <button
          onClick={onSchedule}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          {t('schedule')}
        </button>
      </div>

      {startError && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {startError}
        </p>
      )}

      {currentSessions.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center py-10 text-center">
          <Calendar className="h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">{t('empty')}</p>
          <button
            onClick={onSchedule}
            className="mt-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <CalendarPlus className="h-4 w-4" />
            {t('scheduleFirst')}
          </button>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-gray-100">
          {currentSessions.map((session) => {
            const early = nowMs < new Date(session.scheduled_at).getTime();
            const accepted = session.invitees.filter((i) => i.rsvp_status === 'accepted').length;

            return (
              <div key={session.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{session.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(t, locale, session.scheduled_at, nowMs)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {session.duration_minutes < 60
                          ? t('durationMinutes', { minutes: session.duration_minutes })
                          : t('durationHours', { hours: session.duration_minutes / 60 })}
                      </span>
                      {repeatLabel(tm, session) && (
                        <span
                          className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600"
                          title={describeRecurrenceText(
                            tm,
                            locale,
                            ruleFromRow(session),
                            new Date(session.scheduled_at)
                          )}
                        >
                          <Repeat className="h-3 w-3" />
                          {repeatLabel(tm, session)}
                        </span>
                      )}
                      {session.channel && (
                        <span
                          className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600"
                          title={t('goesLiveOn', { channel: session.channel.name })}
                        >
                          <Radio className="h-3 w-3" />@{session.channel.handle}
                        </span>
                      )}
                      {session.invitee_count > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {t('invited', { count: session.invitee_count })}
                          {accepted > 0 && (
                            <span className="flex items-center gap-0.5 text-green-600">
                              <CheckCircle className="h-3 w-3" />
                              {t('accepted', { count: accepted })}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {session.description && (
                      <p className="mt-1 truncate text-xs text-gray-400">{session.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      href={`/join/${session.join_code}`}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
                    >
                      {session.join_code}
                    </Link>
                    <button
                      onClick={() => void handleStart(session)}
                      disabled={startingId === session.id}
                      title={early ? t('startEarlyHint') : undefined}
                      className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      {startingId === session.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {early ? t('startEarly') : t('startNow')}
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setCalendarOpenId(calendarOpenId === session.id ? null : session.id);
                        }}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                        title={t('addToCalendar')}
                      >
                        <Calendar className="h-4 w-4" />
                      </button>
                      {calendarOpenId === session.id && (
                        <div className="absolute top-full right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                          <a
                            href={buildGoogleCalendarUrl({
                              title: session.title,
                              description: session.description,
                              startIso: session.scheduled_at,
                              durationMinutes: session.duration_minutes,
                              joinUrl: `${window.location.origin}/join/${session.join_code}`,
                              recurrence: ruleFromRow(session),
                            })}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              setCalendarOpenId(null);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <Calendar className="h-3.5 w-3.5 text-gray-400" />
                            Google
                          </a>
                          <a
                            href={buildOutlookUrl({
                              title: session.title,
                              description: session.description,
                              startIso: session.scheduled_at,
                              durationMinutes: session.duration_minutes,
                              joinUrl: `${window.location.origin}/join/${session.join_code}`,
                              recurrence: ruleFromRow(session),
                            })}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              setCalendarOpenId(null);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <Calendar className="h-3.5 w-3.5 text-gray-400" />
                            Outlook
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              downloadIcs({
                                title: session.title,
                                description: session.description,
                                startIso: session.scheduled_at,
                                durationMinutes: session.duration_minutes,
                                joinUrl: `${window.location.origin}/join/${session.join_code}`,
                                recurrence: ruleFromRow(session),
                              });
                              setCalendarOpenId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <Calendar className="h-3.5 w-3.5 text-gray-400" />
                            {t('appleIcal')}
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setEditing(session);
                      }}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                      title={t('editMeeting')}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => void handleCancel(session.id)}
                      disabled={cancellingId === session.id}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      title={t('cancelMeeting')}
                    >
                      {cancellingId === session.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
