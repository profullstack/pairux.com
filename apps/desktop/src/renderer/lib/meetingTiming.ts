import type { ScheduledMeeting } from '../../preload/api';

/**
 * How the picker talks about a meeting's timing.
 *
 * Nothing here decides whether a meeting can be started: the booked time used
 * to be a gate at both ends — fifteen minutes early at one end, the scheduled
 * end at the other — and meetings run late, so a host two hours behind found
 * the Start button dead on the meeting everybody had been emailed a link to.
 * The time orders this list and tells the guests when to turn up; the host
 * decides when the room opens, and the server has never checked the clock.
 *
 * What the app lists is what the web dashboard lists — see the web app's
 * `scheduled-meeting-timing.ts` for the grace a lapsed meeting keeps.
 */

export function meetingEndTime(meeting: ScheduledMeeting): number {
  return new Date(meeting.scheduled_at).getTime() + meeting.duration_minutes * 60 * 1000;
}

/**
 * Not due yet.
 *
 * Starting a meeting mails every invitee that it is beginning now, so a host
 * opening one ahead of its slot is told that is what they are doing.
 */
export function isEarly(meeting: ScheduledMeeting, nowMs: number): boolean {
  return nowMs < new Date(meeting.scheduled_at).getTime();
}

/**
 * Already opened and still running.
 *
 * Measured from when the room actually opened as well as from the booked slot:
 * a meeting started half an hour late is live for its full length, not for
 * whatever was left of the booking.
 */
export function isLive(meeting: ScheduledMeeting, nowMs: number): boolean {
  if (!meeting.started_at) return false;
  const ranUntil = new Date(meeting.started_at).getTime() + meeting.duration_minutes * 60 * 1000;
  return nowMs < Math.max(meetingEndTime(meeting), ranUntil);
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
