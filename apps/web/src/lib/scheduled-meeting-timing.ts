export const SCHEDULED_MEETING_START_EARLY_MS = 15 * 60 * 1000;
export const MAX_SCHEDULED_MEETING_DURATION_MINUTES = 8 * 60;

export interface ScheduledMeetingTiming {
  scheduled_at: string;
  duration_minutes: number;
}

export function scheduledMeetingEndTime(meeting: ScheduledMeetingTiming): number {
  return new Date(meeting.scheduled_at).getTime() + meeting.duration_minutes * 60 * 1000;
}

export function isScheduledMeetingCurrent(
  meeting: ScheduledMeetingTiming,
  nowMs = Date.now()
): boolean {
  return scheduledMeetingEndTime(meeting) > nowMs;
}

export function isScheduledMeetingStartable(
  meeting: ScheduledMeetingTiming,
  nowMs = Date.now()
): boolean {
  const startsAt = new Date(meeting.scheduled_at).getTime();
  return (
    nowMs >= startsAt - SCHEDULED_MEETING_START_EARLY_MS &&
    isScheduledMeetingCurrent(meeting, nowMs)
  );
}

export function earliestPossibleCurrentMeetingStart(nowMs = Date.now()): string {
  return new Date(nowMs - MAX_SCHEDULED_MEETING_DURATION_MINUTES * 60 * 1000).toISOString();
}
