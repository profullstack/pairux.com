'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Calendar, Clock, User, ExternalLink, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { buildGoogleCalendarUrl, buildOutlookUrl, downloadIcs } from '@/lib/calendar';

interface InviteData {
  invitee: {
    id: string;
    email: string;
    name: string | null;
    rsvpStatus: string;
  };
  meeting: {
    id: string;
    title: string;
    description: string | null;
    scheduledAt: string;
    durationMinutes: number;
    joinCode: string;
    status: string;
    hostName: string;
  };
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = minutes / 60;
    return `${String(h)} hour${h > 1 ? 's' : ''}`;
  }
  return `${String(minutes)} minutes`;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string>('');
  const [data, setData] = useState<InviteData | null>(null);
  const [rsvpStatus, setRsvpStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then((p) => {
      setToken(p.token);
    });
  }, [params]);

  const submitRsvp = useCallback(async (tok: string, status: string) => {
    setRsvpLoading(true);
    try {
      const res = await fetch(`/api/invite/${tok}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rsvpStatus: status }),
      });
      if (res.ok) setRsvpStatus(status);
    } finally {
      setRsvpLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    const searchParams = new URLSearchParams(window.location.search);
    const autoRsvp = searchParams.get('rsvp');

    async function load() {
      try {
        const res = await fetch(`/api/invite/${token}`);
        const json = (await res.json()) as { data?: InviteData; error?: string };
        if (!res.ok) throw new Error(json.error ?? 'Invite not found');
        if (json.data) {
          setData(json.data);
          setRsvpStatus(json.data.invitee.rsvpStatus);
        }
        if (autoRsvp === 'accepted' || autoRsvp === 'declined') {
          await submitRsvp(token, autoRsvp);
          setRsvpStatus(autoRsvp);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invite');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [token, submitRsvp]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="text-xl font-semibold text-gray-900">Invite not found</h1>
          <p className="mt-2 text-gray-500">
            {error ?? 'This invite link may be invalid or expired.'}
          </p>
          <Link href="/" className="mt-4 inline-block text-indigo-600 hover:underline">
            Go to PairUX
          </Link>
        </div>
      </div>
    );
  }

  const { meeting, invitee } = data;
  const isCancelled = meeting.status === 'cancelled';
  const joinUrl = `/join/${meeting.joinCode}`;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-6 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 p-6 text-center text-white shadow-lg">
          <p className="text-xs font-semibold tracking-widest text-indigo-200 uppercase">
            Meeting Invitation
          </p>
          <h1 className="mt-2 text-2xl font-bold">{meeting.title}</h1>
          <p className="mt-1 text-sm text-indigo-100">from {meeting.hostName}</p>
        </div>

        {isCancelled && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-700">
            This meeting has been cancelled.
          </div>
        )}

        {/* Meeting Details */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Date &amp; Time</p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">
                  {formatDateTime(meeting.scheduledAt)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Duration</p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">
                  {formatDuration(meeting.durationMinutes)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <User className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Host</p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">{meeting.hostName}</p>
              </div>
            </div>
            {meeting.description && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Notes</p>
                <p className="mt-1 text-sm text-gray-700">{meeting.description}</p>
              </div>
            )}
          </div>
        </div>

        {/* Join Code */}
        {!isCancelled && (
          <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-6 text-center">
            <p className="text-xs font-semibold tracking-wide text-indigo-600 uppercase">
              Your Join Code
            </p>
            <p className="mt-2 font-mono text-4xl font-extrabold tracking-[8px] text-indigo-700">
              {meeting.joinCode}
            </p>
            <p className="mt-2 text-xs text-indigo-400">Use this code when the meeting starts</p>
            <Link
              href={joinUrl}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Join Meeting
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* Add to Calendar */}
        {!isCancelled && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="mb-3 text-sm font-medium text-gray-700">Add to Calendar</p>
            <div className="flex gap-2">
              <a
                href={buildGoogleCalendarUrl({
                  title: meeting.title,
                  description: meeting.description,
                  startIso: meeting.scheduledAt,
                  durationMinutes: meeting.durationMinutes,
                  joinUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://pairux.com'}/join/${meeting.joinCode}`,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                Google
              </a>
              <a
                href={buildOutlookUrl({
                  title: meeting.title,
                  description: meeting.description,
                  startIso: meeting.scheduledAt,
                  durationMinutes: meeting.durationMinutes,
                  joinUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://pairux.com'}/join/${meeting.joinCode}`,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                Outlook
              </a>
              <button
                type="button"
                onClick={() => {
                  downloadIcs({
                    title: meeting.title,
                    description: meeting.description,
                    startIso: meeting.scheduledAt,
                    durationMinutes: meeting.durationMinutes,
                    joinUrl: `${window.location.origin}/join/${meeting.joinCode}`,
                  });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                Apple / iCal
              </button>
            </div>
          </div>
        )}

        {/* RSVP */}
        {!isCancelled && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            {rsvpStatus === 'accepted' ? (
              <div>
                <CheckCircle className="mx-auto mb-2 h-10 w-10 text-green-500" />
                <p className="font-semibold text-gray-900">You accepted!</p>
                <p className="mt-1 text-sm text-gray-500">We&apos;ll see you at the meeting.</p>
                <button
                  onClick={() => void submitRsvp(token, 'declined')}
                  disabled={rsvpLoading}
                  className="mt-3 text-xs text-gray-400 underline hover:text-gray-600"
                >
                  Can&apos;t make it after all?
                </button>
              </div>
            ) : rsvpStatus === 'declined' ? (
              <div>
                <XCircle className="mx-auto mb-2 h-10 w-10 text-gray-400" />
                <p className="font-semibold text-gray-900">You declined</p>
                <p className="mt-1 text-sm text-gray-500">
                  You&apos;ve indicated you can&apos;t attend.
                </p>
                <button
                  onClick={() => void submitRsvp(token, 'accepted')}
                  disabled={rsvpLoading}
                  className="mt-3 text-xs text-indigo-500 underline hover:text-indigo-700"
                >
                  Changed your mind?
                </button>
              </div>
            ) : (
              <div>
                <p className="mb-4 font-medium text-gray-900">Will you attend?</p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => void submitRsvp(token, 'accepted')}
                    disabled={rsvpLoading}
                    className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Yes, I&apos;ll be there
                  </button>
                  <button
                    onClick={() => void submitRsvp(token, 'declined')}
                    disabled={rsvpLoading}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    Can&apos;t make it
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Invited as {invitee.email} ·{' '}
          <Link href="https://pairux.com" className="hover:text-indigo-500">
            pairux.com
          </Link>
        </p>
      </div>
    </div>
  );
}
