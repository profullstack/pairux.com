/**
 * When a scheduled meeting is still the meeting you are about to run.
 *
 * Meetings run late. The previous rules said an occurrence stopped existing the
 * instant its booked minutes were up: the row dropped out of the "upcoming"
 * list, the Start button went dead, and a recurring series jumped to next week
 * — so a host who turned up two hours late for a 10am weekly sync had no way to
 * open the room everyone had been emailed a link to.
 *
 * A booked time is now a plan, not a gate. It orders the list and it is what
 * invitees were told; it does not decide whether the host may open the room.
 */

/**
 * How long after its booked end a meeting is still the current one.
 *
 * Long enough that no realistic delay outlives it, short enough that a meeting
 * nobody ran is gone from the picker by the next working day. A recurring
 * series never carries the grace past its next occurrence — see `advanceSeries`.
 */
export const SCHEDULED_MEETING_LATE_GRACE_MS = 12 * 60 * 60 * 1000;

export const MAX_SCHEDULED_MEETING_DURATION_MINUTES = 8 * 60;

export interface ScheduledMeetingTiming {
  scheduled_at: string;
  duration_minutes: number;
}

export function scheduledMeetingEndTime(meeting: ScheduledMeetingTiming): number {
  return new Date(meeting.scheduled_at).getTime() + meeting.duration_minutes * 60 * 1000;
}

/** Still listed: booked for the future, under way, or recently overrun. */
export function isScheduledMeetingCurrent(
  meeting: ScheduledMeetingTiming,
  nowMs = Date.now()
): boolean {
  return scheduledMeetingEndTime(meeting) + SCHEDULED_MEETING_LATE_GRACE_MS > nowMs;
}

/** The oldest `scheduled_at` an "upcoming" query could still need to return. */
export function earliestPossibleCurrentMeetingStart(nowMs = Date.now()): string {
  return new Date(
    nowMs - MAX_SCHEDULED_MEETING_DURATION_MINUTES * 60 * 1000 - SCHEDULED_MEETING_LATE_GRACE_MS
  ).toISOString();
}
