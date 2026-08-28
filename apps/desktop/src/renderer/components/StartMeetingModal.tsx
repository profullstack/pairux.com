import { useCallback, useEffect, useState } from 'react';
import { X, Calendar, Loader2, Play, Users, Repeat, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getElectronAPI } from '@/lib/ipc';
import {
  acceptedCount,
  clockTime,
  isEarly,
  isLive,
  orderForPicker,
  relativeStart,
} from '@/lib/meetingTiming';
import type { ScheduledMeeting } from '../../preload/api';
import type { Session } from '@pairux/shared-types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStarted: (session: Session) => void;
}

/**
 * Pick a booked meeting and open it.
 *
 * The calendar invite an attendee holds names exactly one meeting, so it was
 * the only thing that knew which meeting was which — a host with a full day
 * had no list anywhere in the app. This is that list, and starting from it is
 * what tells the guest list the room is open.
 */
export function StartMeetingModal({ isOpen, onClose, onStarted }: Props) {
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getElectronAPI().invoke('meetings:list', undefined);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMeetings(result.meetings);
    } catch {
      setError('Could not reach pairux.com');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  // "in 3 minutes" going stale while the modal sits open is also the button
  // still offering to start early on a meeting that is now due.
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isOpen]);

  const handleStart = useCallback(
    async (meeting: ScheduledMeeting) => {
      setStartingId(meeting.id);
      setError(null);
      try {
        const result = await getElectronAPI().invoke('meetings:start', {
          scheduledSessionId: meeting.id,
        });
        if (!result.success) {
          setError(result.error);
          return;
        }
        onStarted(result.session);
      } catch {
        setError('Could not start the meeting');
      } finally {
        setStartingId(null);
      }
    },
    [onStarted]
  );

  if (!isOpen) return null;

  const ordered = orderForPicker(meetings, nowMs);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col border-border">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Start a Meeting</CardTitle>
                <CardDescription>Everyone invited is emailed a link when you do</CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 space-y-3 overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
              <Button
                variant="link"
                className="ml-2 h-auto p-0 text-destructive"
                onClick={() => void load()}
              >
                Try again
              </Button>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">Loading your meetings...</p>
            </div>
          )}

          {!isLoading && ordered.length === 0 && !error && (
            <div className="py-10 text-center">
              <Calendar className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-4 text-sm font-medium text-foreground">No meetings booked</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Schedule one on pairux.com and it will show up here.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  void getElectronAPI().invoke('auth:openExternal', '/dashboard');
                }}
              >
                Open dashboard
              </Button>
            </div>
          )}

          {!isLoading &&
            ordered.map((meeting) => {
              const live = isLive(meeting, nowMs);
              const early = isEarly(meeting, nowMs);
              const accepted = acceptedCount(meeting);

              return (
                <div
                  key={meeting.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-foreground">{meeting.title}</p>
                      {live && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-500">
                          <Radio className="h-3 w-3" />
                          Live
                        </span>
                      )}
                      {meeting.recurrence_freq && (
                        <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {relativeStart(meeting, nowMs)} · {clockTime(meeting)}
                    </p>

                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {meeting.invitee_count === 0
                          ? 'No guests'
                          : `${String(accepted)}/${String(meeting.invitee_count)} accepted`}
                      </span>
                      <span className="font-mono tracking-widest">{meeting.join_code}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => void handleStart(meeting)}
                    disabled={startingId !== null}
                    className="shrink-0"
                    title={early ? 'Opens the room now and emails everyone invited' : undefined}
                  >
                    {startingId === meeting.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        {live ? 'Rejoin' : early ? 'Start early' : 'Start'}
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
