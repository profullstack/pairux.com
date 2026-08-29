import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Monitor, User, Loader2, Users, ArrowLeft, Calendar, Clock } from 'lucide-react';

/**
 * Parse a join code from user input. Handles both raw codes and full URLs.
 * Examples:
 *   "ABC123" -> "ABC123"
 *   "https://pairux.com/join/abc123" -> "ABC123"
 *   "pairux.com/join/XYZ789" -> "XYZ789"
 */
function parseJoinInput(input: string): string {
  const trimmed = input.trim();
  // Try to extract code from URL pattern
  const urlMatch = /\/join\/([A-Z0-9]{6})/i.exec(trimmed);
  if (urlMatch) {
    return urlMatch[1].toUpperCase();
  }
  // Otherwise treat as raw code - strip non-alphanumeric and uppercase
  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function fmtIcs(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function buildGoogleCalendarUrl(
  title: string,
  description: string | null,
  startIso: string,
  durationMinutes: number,
  joinUrl: string
): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const details = [description, `Join at: ${joinUrl}`].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmtIcs(start)}/${fmtIcs(end)}`,
    details,
    location: joinUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookUrl(
  title: string,
  description: string | null,
  startIso: string,
  durationMinutes: number,
  joinUrl: string
): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const body = [description, `Join at: ${joinUrl}`].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    subject: title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body,
    location: joinUrl,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function downloadIcs(
  title: string,
  description: string | null,
  startIso: string,
  durationMinutes: number,
  joinUrl: string
): void {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const desc = [description, `Join at: ${joinUrl}`].filter(Boolean).join('\\n\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PairUX//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmtIcs(start)}`,
    `DTEND:${fmtIcs(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${joinUrl}`,
    `URL:${joinUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]/gi, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatScheduledTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
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

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useAuthStore } from '@/stores/auth';
import { getElectronAPI } from '@/lib/ipc';

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
  id: string;
  join_code: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  invitees: { name: string | null; rsvp_status: string }[];
}

const API_BASE = 'https://pairux.com';

export function JoinPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);

  const [joinCode, setJoinCode] = useState(searchParams.get('code') ?? '');
  const [displayName, setDisplayName] = useState('');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledSessionInfo | null>(null);
  const [countdown, setCountdown] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (displayName.trim()) return;

    const profileName = profile?.display_name?.trim() ?? '';
    const emailPrefix = user?.email ? user.email.split('@')[0].trim() : '';
    const preferredName = profileName || emailPrefix;

    if (preferredName) {
      setDisplayName(preferredName);
    }
  }, [profile?.display_name, user?.email, displayName]);

  // Countdown + polling when a scheduled session is shown
  useEffect(() => {
    if (!scheduled) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    setCountdown(formatCountdown(scheduled.scheduled_at));
    const tick = setInterval(() => {
      setCountdown(formatCountdown(scheduled.scheduled_at));
    }, 30000);

    pollRef.current = setInterval(() => {
      const api = getElectronAPI();
      void api
        .invoke('session:lookup', { joinCode: scheduled.join_code })
        .then((result) => {
          if (result.success && 'session' in result) {
            setSession(result.session);
            setScheduled(null);
          }
        })
        .catch(() => undefined);
    }, 30000);

    return () => {
      clearInterval(tick);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scheduled]);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setError('');
    setLoading(true);
    setSession(null);
    setScheduled(null);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:lookup', { joinCode: joinCode.trim() });

      if (!result.success) {
        setError(result.error);
        return;
      }

      if ('scheduledSession' in result) {
        setScheduled(result.scheduledSession);
      } else {
        setSession(result.session);
      }
    } catch {
      setError('Failed to lookup session');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    // Require display name if not authenticated
    if (!user && !displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    setError('');
    setJoining(true);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:join', {
        joinCode: session.join_code,
        displayName: displayName.trim() || undefined,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      // Navigate to viewer page
      void navigate(`/viewer/${session.id}`);
    } catch {
      setError('Failed to join session');
    } finally {
      setJoining(false);
    }
  };

  const handleBack = () => {
    if (session || scheduled) {
      setSession(null);
      setScheduled(null);
      setError('');
    } else {
      void navigate('/');
    }
  };

  const openExternal = (url: string) => {
    const api = getElectronAPI();
    void api.invoke('auth:openExternal', url);
  };

  // Scheduled session view
  if (scheduled) {
    const joinUrl = `${API_BASE}/join/${scheduled.join_code}`;
    const accepted = scheduled.invitees.filter((i) => i.rsvp_status === 'accepted');
    const named = scheduled.invitees.filter((i) => i.name);

    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="drag-region h-8 w-full" />
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-md border-border">
            <CardHeader className="space-y-1 text-center">
              <div className="mb-2 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100">
                  <Calendar className="h-6 w-6 text-indigo-600" />
                </div>
              </div>
              <CardTitle className="text-xl font-semibold">{scheduled.title}</CardTitle>
              <CardDescription className="font-medium text-indigo-500">{countdown}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
                <div className="flex items-start gap-2 text-foreground">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{formatScheduledTime(scheduled.scheduled_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    {scheduled.duration_minutes < 60
                      ? `${String(scheduled.duration_minutes)} minutes`
                      : `${String(scheduled.duration_minutes / 60)} hour${scheduled.duration_minutes > 60 ? 's' : ''}`}
                  </span>
                </div>
                {scheduled.invitees.length > 0 && (
                  <div className="flex items-start gap-2 text-foreground">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
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
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {named.map((i) => i.name).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {scheduled.description && (
                  <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                    {scheduled.description}
                  </p>
                )}
              </div>

              <p className="text-center text-xs text-muted-foreground">
                This page will automatically update when the host starts the session.
              </p>

              <div className="rounded-lg border border-border bg-muted p-3 text-center">
                <p className="text-xs text-muted-foreground">Join code</p>
                <p className="mt-0.5 font-mono text-lg font-bold tracking-widest">
                  {scheduled.join_code}
                </p>
              </div>

              <div>
                <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
                  Add to Calendar
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      openExternal(
                        buildGoogleCalendarUrl(
                          scheduled.title,
                          scheduled.description,
                          scheduled.scheduled_at,
                          scheduled.duration_minutes,
                          joinUrl
                        )
                      );
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    Google
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      openExternal(
                        buildOutlookUrl(
                          scheduled.title,
                          scheduled.description,
                          scheduled.scheduled_at,
                          scheduled.duration_minutes,
                          joinUrl
                        )
                      );
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    Outlook
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadIcs(
                        scheduled.title,
                        scheduled.description,
                        scheduled.scheduled_at,
                        scheduled.duration_minutes,
                        joinUrl
                      );
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    Apple / iCal
                  </button>
                </div>
              </div>

              <Button type="button" variant="outline" onClick={handleBack} className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Simple drag region for window control */}
      <div className="drag-region h-8 w-full" />

      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md border-border">
          <CardHeader className="space-y-1 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Monitor className="h-6 w-6" />
              </div>
            </div>
            <CardTitle className="text-2xl font-semibold">
              {session ? 'Join Session' : 'Enter Join Code'}
            </CardTitle>
            <CardDescription>
              {session
                ? "You're about to join a screen sharing session"
                : 'Enter a join code or paste a link'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <ErrorBanner
                message={error}
                onDismiss={() => {
                  setError('');
                }}
                className="mb-4"
              />
            )}

            {!session ? (
              <form onSubmit={(e) => void handleLookup(e)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="joinCode">Join Code or Link</Label>
                  <Input
                    id="joinCode"
                    type="text"
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(parseJoinInput(e.target.value));
                    }}
                    placeholder="ABC123 or paste link"
                    className="text-center font-mono text-lg"
                    autoFocus
                    required
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    Enter the 6-character code or paste a join link
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleBack} className="flex-1">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={loading || !joinCode.trim()}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {loading ? 'Looking up...' : 'Continue'}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="mb-6 rounded-lg bg-muted p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Session Code</span>
                    <span className="font-mono font-semibold">{session.join_code}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Participants</span>
                    <span className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {session.participant_count} / {session.settings.maxParticipants ?? 5}
                    </span>
                  </div>
                </div>

                <form onSubmit={(e) => void handleJoin(e)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName">
                      Your Name {user && <span className="text-muted-foreground">(optional)</span>}
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="displayName"
                        type="text"
                        value={displayName}
                        onChange={(e) => {
                          setDisplayName(e.target.value);
                        }}
                        placeholder={user ? 'Use account name' : 'Enter your name'}
                        className="pl-10"
                        maxLength={50}
                        required={!user}
                        autoFocus
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This is how others will see you in the session
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={handleBack} className="flex-1">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={joining || (!user && !displayName.trim())}
                    >
                      {joining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {joining ? 'Joining...' : 'Join Session'}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
