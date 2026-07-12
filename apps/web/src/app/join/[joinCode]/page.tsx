'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  Loader2,
  AlertCircle,
  Users,
  Monitor,
  CheckCircle,
  Calendar,
  Clock,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { buildGoogleCalendarUrl, buildOutlookUrl, downloadIcs } from '@/lib/calendar';

interface SessionInfo {
  id: string;
  join_code: string;
  status: string;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  participant_count: number;
}

interface ScheduledSessionInfo {
  scheduled: true;
  id: string;
  join_code: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  invitees: { name: string | null; rsvp_status: string }[];
}

interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
}

interface SessionResponse {
  user: { id: string; email: string } | null;
  profile: UserProfile | null;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

function formatScheduledTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Starting now';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `Starts in ${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `Starts in ${String(hours)}h ${String(mins)}m`;
  return `Starts in ${String(mins)}m`;
}

export default function JoinPage({ params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledSessionInfo | null>(null);
  const [countdown, setCountdown] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [user, setUser] = useState<SessionResponse['user']>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Fetch user session on mount
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = (await res.json()) as ApiResponse<SessionResponse>;
          if (data.data) {
            setUser(data.data.user);
            setProfile(data.data.profile);
            if (data.data.profile?.display_name) {
              setDisplayName(data.data.profile.display_name);
            }
          }
        }
      } catch {
        // User not logged in
      }
    }
    void fetchUser();
  }, []);

  // Lookup session
  useEffect(() => {
    async function lookupSession() {
      try {
        const res = await fetch(`/api/sessions/join/${joinCode}`);
        const data = (await res.json()) as ApiResponse<SessionInfo | ScheduledSessionInfo>;

        if (!res.ok) {
          setError(data.error ?? 'Session not found');
          setLoading(false);
          return;
        }

        if (data.data && 'scheduled' in data.data) {
          setScheduled(data.data);
        } else if (data.data) {
          setSession(data.data);
        }
      } catch {
        setError('Failed to lookup session');
      } finally {
        setLoading(false);
      }
    }

    void lookupSession();
  }, [joinCode]);

  // Countdown ticker + polling for live session when scheduled
  useEffect(() => {
    if (!scheduled) return;
    setCountdown(formatCountdown(scheduled.scheduled_at));
    const tick = setInterval(() => {
      setCountdown(formatCountdown(scheduled.scheduled_at));
    }, 30000);
    // Poll every 30s to detect when the host starts the session
    const poll = setInterval(() => {
      void fetch(`/api/sessions/join/${joinCode}`)
        .then((r) => r.json())
        .then((d: ApiResponse<SessionInfo | ScheduledSessionInfo>) => {
          if (d.data && !('scheduled' in d.data)) {
            setSession(d.data);
            setScheduled(null);
          }
        })
        .catch(() => undefined);
    }, 30000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [scheduled, joinCode]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();

    setError('');
    setJoining(true);

    try {
      // For authenticated users, displayName is optional
      const body = user ? { displayName: displayName || undefined } : { displayName };

      const res = await fetch(`/api/sessions/join/${joinCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as ApiResponse<{ id: string; session_id: string }>;

      if (!res.ok) {
        setError(data.error ?? 'Failed to join session');
        return;
      }

      // Redirect to appropriate viewer
      if (session?.id && data.data) {
        if (user) {
          // Authenticated users go to protected session page
          router.push(`/session/${session.id}`);
        } else {
          // Guests go to public view page with participant token
          router.push(`/view/${session.id}?p=${data.data.id}`);
        }
      }
    } catch {
      setError('Failed to join session');
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="text-primary-600 mx-auto h-8 w-8 animate-spin" />
          <p className="mt-4 text-sm text-gray-600">Looking up session...</p>
        </div>
      </div>
    );
  }

  if (scheduled) {
    const accepted = scheduled.invitees.filter((i) => i.rsvp_status === 'accepted');
    const named = scheduled.invitees.filter((i) => i.name);
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center">
              <Logo size="sm" />
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
          <div className="w-full max-w-md">
            <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
              <div className="mb-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
                  <Calendar className="h-6 w-6 text-indigo-600" />
                </div>
                <h1 className="mt-4 text-2xl font-bold text-gray-900">{scheduled.title}</h1>
                <p className="mt-1 text-sm font-medium text-indigo-600">{countdown}</p>
              </div>

              <div className="space-y-3 rounded-lg bg-gray-50 p-4 text-sm">
                <div className="flex items-start gap-2 text-gray-700">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span>{formatScheduledTime(scheduled.scheduled_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-700">
                  <Clock className="h-4 w-4 shrink-0 text-gray-400" />
                  <span>
                    {scheduled.duration_minutes < 60
                      ? `${String(scheduled.duration_minutes)} minutes`
                      : `${String(scheduled.duration_minutes / 60)} hour${scheduled.duration_minutes > 60 ? 's' : ''}`}
                  </span>
                </div>
                {scheduled.invitees.length > 0 && (
                  <div className="flex items-start gap-2 text-gray-700">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <div>
                      <span>
                        {String(scheduled.invitees.length)} invited
                        {accepted.length > 0 && (
                          <span className="ml-1 text-green-600">
                            · {String(accepted.length)} accepted
                          </span>
                        )}
                      </span>
                      {named.length > 0 && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {named.map((i) => i.name).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {scheduled.description && (
                  <p className="border-t border-gray-200 pt-3 text-xs text-gray-500">
                    {scheduled.description}
                  </p>
                )}
              </div>

              <p className="mt-6 text-center text-xs text-gray-400">
                This page will automatically update when the host starts the session.
              </p>

              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500">Join code</p>
                <p className="mt-0.5 font-mono text-lg font-bold tracking-widest text-gray-900">
                  {scheduled.join_code}
                </p>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-center text-xs font-medium text-gray-500">
                  Add to Calendar
                </p>
                <div className="flex gap-2">
                  <a
                    href={buildGoogleCalendarUrl({
                      title: scheduled.title,
                      description: scheduled.description,
                      startIso: scheduled.scheduled_at,
                      durationMinutes: scheduled.duration_minutes,
                      joinUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://pairux.com'}/join/${scheduled.join_code}`,
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
                      title: scheduled.title,
                      description: scheduled.description,
                      startIso: scheduled.scheduled_at,
                      durationMinutes: scheduled.duration_minutes,
                      joinUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://pairux.com'}/join/${scheduled.join_code}`,
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
                        title: scheduled.title,
                        description: scheduled.description,
                        startIso: scheduled.scheduled_at,
                        durationMinutes: scheduled.duration_minutes,
                        joinUrl: `${window.location.origin}/join/${scheduled.join_code}`,
                      });
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Calendar className="h-3.5 w-3.5 text-gray-400" />
                    Apple / iCal
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center">
              <Link href="/" className="flex items-center gap-2">
                <div className="bg-primary-600 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
                  P
                </div>
                <span className="text-xl font-bold text-gray-900">PairUX</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-gray-900">Session Not Found</h1>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
            <Link
              href="/"
              className="bg-primary-600 hover:bg-primary-700 mt-6 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              Go to Homepage
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center">
            <Logo size="sm" />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <div className="bg-primary-100 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <Monitor className="text-primary-600 h-6 w-6" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-gray-900">Join Session</h1>
              <p className="mt-2 text-sm text-gray-600">
                You&apos;re about to join a screen sharing session
              </p>
            </div>

            {session && (
              <div className="mb-6 rounded-lg bg-gray-50 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Session Code</span>
                  <span className="font-mono font-semibold text-gray-900">{session.join_code}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Status</span>
                  <span
                    className={`flex items-center gap-1 font-medium ${
                      session.status === 'active' ? 'text-green-600' : 'text-orange-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        session.status === 'active' ? 'bg-green-500' : 'bg-orange-500'
                      }`}
                    />
                    {session.status === 'active'
                      ? 'Host is sharing'
                      : session.status === 'paused'
                        ? 'Host not currently present'
                        : 'Waiting for host'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Participants</span>
                  <span className="flex items-center gap-1 text-gray-900">
                    <Users className="h-4 w-4" />
                    {session.participant_count} / {session.settings.maxParticipants ?? 5}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={(e) => void handleJoin(e)} className="space-y-4">
              {user ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">
                      Signed in as {profile?.display_name ?? user.email}
                    </span>
                  </div>
                  <div className="mt-2">
                    <label
                      htmlFor="displayName"
                      className="block text-xs font-medium text-green-700"
                    >
                      Display name (optional)
                    </label>
                    <input
                      id="displayName"
                      type="text"
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                      }}
                      maxLength={50}
                      className="mt-1 block w-full rounded border border-green-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
                      placeholder={profile?.display_name ?? 'Use account name'}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
                    Your Name
                  </label>
                  <div className="relative mt-1">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      id="displayName"
                      type="text"
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                      }}
                      required
                      minLength={2}
                      maxLength={50}
                      className="focus:border-primary-500 focus:ring-primary-500 block w-full rounded-lg border border-gray-300 py-2.5 pr-3 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none"
                      placeholder="Enter your name"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    This is how others will see you in the session
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={joining || (!user && !displayName.trim())}
                className="bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow transition-all focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joining && <Loader2 className="h-4 w-4 animate-spin" />}
                {joining ? 'Joining...' : user ? 'Join Session' : 'Watch for free'}
              </button>
            </form>

            {!user && (
              <>
                <p className="mt-3 text-center text-xs text-gray-500">
                  No account needed — watch live as a guest.
                </p>
                <p className="mt-4 text-center text-xs text-gray-500">
                  Have an account?{' '}
                  <Link
                    href={`/login?redirect=/join/${joinCode}`}
                    className="text-primary-600 hover:text-primary-500 font-medium"
                  >
                    Sign in
                  </Link>{' '}
                  to present or take control
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
