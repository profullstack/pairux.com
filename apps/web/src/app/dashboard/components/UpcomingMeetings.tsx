'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Users,
  Clock,
  Play,
  Trash2,
  Loader2,
  CalendarPlus,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { buildGoogleCalendarUrl, buildOutlookUrl, downloadIcs } from '@/lib/calendar';

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
}

interface ListResponse {
  data?: ScheduledSession[];
  error?: string;
}

interface StartResponse {
  data?: { id: string; join_code: string };
  error?: string;
}

interface AddInviteesResponse {
  data?: { added: Invitee[]; skipped: string[]; invitee_count: number };
  error?: string;
}

interface RemoveInviteeResponse {
  data?: { removed: Invitee; notified: boolean; invitee_count: number };
  error?: string;
}

const RSVP_PENDING_STYLE = 'bg-gray-100 text-gray-500';
const RSVP_STYLES: Record<string, string> = {
  accepted: 'bg-green-50 text-green-700',
  declined: 'bg-red-50 text-red-600',
  pending: RSVP_PENDING_STYLE,
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (diffDays === 0) return `Today at ${timeStr}`;
  if (diffDays === 1) return `Tomorrow at ${timeStr}`;
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isStartable(isoString: string): boolean {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  // Allow starting up to 15 min early or if it's overdue by less than duration
  return diffMs <= 15 * 60 * 1000;
}

interface Props {
  onSchedule: () => void;
}

export function UpcomingMeetings({ onSchedule }: Props) {
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [calendarOpenId, setCalendarOpenId] = useState<string | null>(null);
  const [invitesOpenId, setInvitesOpenId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [removingInviteeId, setRemovingInviteeId] = useState<string | null>(null);
  const [notifyOnRemove, setNotifyOnRemove] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled-sessions?filter=upcoming');
      const json = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setSessions(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load upcoming meetings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  async function handleStart(session: ScheduledSession) {
    setStartingId(session.id);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxParticipants: 10,
          allowGuestControl: false,
          mode: 'p2p',
          joinCode: session.join_code,
        }),
      });
      const json = (await res.json()) as StartResponse;
      if (res.ok && json.data?.id) {
        window.location.href = `/host/${json.data.id}`;
      }
    } finally {
      setStartingId(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this scheduled meeting? Invitees will be notified.')) return;
    setCancellingId(id);
    try {
      await fetch(`/api/scheduled-sessions/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setCancellingId(null);
    }
  }

  function toggleInvites(id: string) {
    setInvitesOpenId(invitesOpenId === id ? null : id);
    setInviteEmail('');
    setInviteError(null);
  }

  async function handleAddInvitee(sessionId: string) {
    const email = inviteEmail.trim();
    if (!email) return;

    setInvitingId(sessionId);
    setInviteError(null);
    try {
      const res = await fetch(`/api/scheduled-sessions/${sessionId}/invitees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitees: [email] }),
      });
      const json = (await res.json()) as AddInviteesResponse;
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Failed to add invitee');

      const { added, skipped } = json.data;
      const alreadyInvited = skipped[0];
      if (added.length === 0 && alreadyInvited !== undefined) {
        setInviteError(`${alreadyInvited} is already invited`);
        return;
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                invitees: [...s.invitees, ...added],
                invitee_count: s.invitee_count + added.length,
              }
            : s
        )
      );
      setInviteEmail('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to add invitee');
    } finally {
      setInvitingId(null);
    }
  }

  async function handleRemoveInvitee(sessionId: string, invitee: Invitee) {
    if (!confirm(`Remove ${invitee.email} from this meeting?`)) return;

    setRemovingInviteeId(invitee.id);
    setInviteError(null);
    try {
      const query = notifyOnRemove ? '?notify=true' : '';
      const res = await fetch(
        `/api/scheduled-sessions/${sessionId}/invitees/${invitee.id}${query}`,
        { method: 'DELETE' }
      );
      const json = (await res.json()) as RemoveInviteeResponse;
      if (!res.ok) throw new Error(json.error ?? 'Failed to remove invitee');

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                invitees: s.invitees.filter((i) => i.id !== invitee.id),
                invitee_count: Math.max(0, s.invitee_count - 1),
              }
            : s
        )
      );
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to remove invitee');
    } finally {
      setRemovingInviteeId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming Meetings</h2>
        <div className="mt-4 flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming Meetings</h2>
        <p className="mt-3 text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming Meetings</h2>
        <button
          onClick={onSchedule}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          Schedule
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center py-10 text-center">
          <Calendar className="h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No upcoming meetings scheduled</p>
          <button
            onClick={onSchedule}
            className="mt-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <CalendarPlus className="h-4 w-4" />
            Schedule your first meeting
          </button>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-gray-100">
          {sessions.map((session) => {
            const startable = isStartable(session.scheduled_at);
            const accepted = session.invitees.filter((i) => i.rsvp_status === 'accepted').length;

            return (
              <div key={session.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{session.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(session.scheduled_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {session.duration_minutes < 60
                          ? `${String(session.duration_minutes)}m`
                          : `${String(session.duration_minutes / 60)}h`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          toggleInvites(session.id);
                        }}
                        className="flex items-center gap-1 rounded transition-colors hover:text-indigo-600"
                        aria-expanded={invitesOpenId === session.id}
                        title="Manage invitees"
                      >
                        <Users className="h-3 w-3" />
                        {session.invitee_count > 0
                          ? `${String(session.invitee_count)} invited`
                          : 'Invite people'}
                        {accepted > 0 && (
                          <span className="flex items-center gap-0.5 text-green-600">
                            <CheckCircle className="h-3 w-3" />
                            {accepted} accepted
                          </span>
                        )}
                        {invitesOpenId === session.id ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                    {session.description && (
                      <p className="mt-1 truncate text-xs text-gray-400">{session.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {startable ? (
                      <button
                        onClick={() => void handleStart(session)}
                        disabled={startingId === session.id}
                        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                      >
                        {startingId === session.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        Start Now
                      </button>
                    ) : (
                      <Link
                        href={`/join/${session.join_code}`}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
                      >
                        {session.join_code}
                      </Link>
                    )}
                    <div className="relative">
                      <button
                        onClick={() => {
                          setCalendarOpenId(calendarOpenId === session.id ? null : session.id);
                        }}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                        title="Add to calendar"
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
                              });
                              setCalendarOpenId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <Calendar className="h-3.5 w-3.5 text-gray-400" />
                            Apple / iCal
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => void handleCancel(session.id)}
                      disabled={cancellingId === session.id}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      title="Cancel meeting"
                    >
                      {cancellingId === session.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {invitesOpenId === session.id && (
                  <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                    {session.invitees.length === 0 ? (
                      <p className="text-xs text-gray-400">No one is invited yet.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100">
                        {session.invitees.map((invitee) => (
                          <li
                            key={invitee.id}
                            className="flex items-center justify-between gap-2 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-gray-700">
                                {invitee.name ?? invitee.email}
                              </p>
                              {invitee.name && (
                                <p className="truncate text-[11px] text-gray-400">
                                  {invitee.email}
                                </p>
                              )}
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                RSVP_STYLES[invitee.rsvp_status] ?? RSVP_PENDING_STYLE
                              }`}
                            >
                              {invitee.rsvp_status}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveInvitee(session.id, invitee)}
                              disabled={removingInviteeId === invitee.id}
                              className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                              title={`Remove ${invitee.email}`}
                              aria-label={`Remove ${invitee.email}`}
                            >
                              {removingInviteeId === invitee.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleAddInvitee(session.id);
                      }}
                      className="mt-2 flex items-center gap-2"
                    >
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => {
                          setInviteEmail(e.target.value);
                          setInviteError(null);
                        }}
                        placeholder="name@example.com"
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={invitingId === session.id || inviteEmail.trim() === ''}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {invitingId === session.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" />
                        )}
                        Invite
                      </button>
                    </form>

                    <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500">
                      <input
                        type="checkbox"
                        checked={notifyOnRemove}
                        onChange={(e) => {
                          setNotifyOnRemove(e.target.checked);
                        }}
                        className="h-3 w-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                      />
                      Email people when I remove them
                    </label>

                    {inviteError && (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-red-500">
                        <XCircle className="h-3 w-3 shrink-0" />
                        {inviteError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
