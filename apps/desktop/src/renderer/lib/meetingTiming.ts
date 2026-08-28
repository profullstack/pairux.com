import type { ScheduledMeeting } from '../../preload/api';

/**
 * When a meeting can be started, and how to say when it is.
 *
 * Deliberately the same rules as the web dashboard's
 * `scheduled-meeting-timing.ts`: a host looking at the same meeting in the app
 * and in the browser must not be told two different things about whether it can
 * be started. Kept separate rather than imported because the desktop bundle
 * does not depend on the web app.
 */

export const START_EARLY_MS = 15 * 60 * 1000;

export function meetingEndTime(meeting: ScheduledMeeting): number {
  return new Date(meeting.scheduled_at).getTime() + meeting.duration_minutes * 60 * 1000;
}

/** Startable from fifteen minutes early until its scheduled end. */
export function isStartable(meeting: ScheduledMeeting, nowMs: number): boolean {
  const startsAt = new Date(meeting.scheduled_at).getTime();
  return nowMs >= startsAt - START_EARLY_MS && nowMs < meetingEndTime(meeting);
}

/** Already opened, and still inside the time it was booked for. */
export function isLive(meeting: ScheduledMeeting, nowMs: number): boolean {
  return Boolean(meeting.started_at) && nowMs < meetingEndTime(meeting);
}

/**
 * "in 20 minutes", "started 5 minutes ago", "now".
 *
 * Relative rather than a clock time because the picker's question is always how
 * close a meeting is, and a host reading "14:30" has to work that out.
 */
export function relativeStart(meeting: ScheduledMeeting, nowMs: number): string {
  const diffMs = new Date(meeting.scheduled_at).getTime() - nowMs;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  if (minutes < 1) return 'now';

  const label =
    minutes < 60
      ? `${String(minutes)} minute${minutes === 1 ? '' : 's'}`
      : minutes < 60 * 24
        ? `${String(Math.round(minutes / 60))} hour${Math.round(minutes / 60) === 1 ? '' : 's'}`
        : `${String(Math.round(minutes / (60 * 24)))} day${Math.round(minutes / (60 * 24)) === 1 ? '' : 's'}`;

  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
}

export function clockTime(meeting: ScheduledMeeting): string {
  return new Date(meeting.scheduled_at).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Live first, then whatever starts soonest. */
export function orderForPicker(meetings: ScheduledMeeting[], nowMs: number): ScheduledMeeting[] {
  return [...meetings].sort((a, b) => {
    const liveDiff = Number(isLive(b, nowMs)) - Number(isLive(a, nowMs));
    if (liveDiff !== 0) return liveDiff;
    return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
  });
}

export function acceptedCount(meeting: ScheduledMeeting): number {
  return meeting.invitees.filter((invitee) => invitee.rsvp_status === 'accepted').length;
}
