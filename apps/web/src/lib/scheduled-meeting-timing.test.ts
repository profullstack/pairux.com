import { describe, expect, it } from 'vitest';
import {
  earliestPossibleCurrentMeetingStart,
  isScheduledMeetingCurrent,
  scheduledMeetingEndTime,
  SCHEDULED_MEETING_LATE_GRACE_MS,
} from './scheduled-meeting-timing';

const meeting = {
  scheduled_at: '2026-08-14T17:00:00.000Z',
  duration_minutes: 60,
};

describe('scheduled meeting timing', () => {
  it('ends when its booked minutes are up', () => {
    expect(scheduledMeetingEndTime(meeting)).toBe(Date.parse('2026-08-14T18:00:00.000Z'));
  });

  it('keeps an overrun meeting current, because meetings run late', () => {
    // The host is two hours behind: this is still the meeting they are running.
    expect(isScheduledMeetingCurrent(meeting, Date.parse('2026-08-14T20:00:00.000Z'))).toBe(true);
  });

  it('drops it once the grace period is spent', () => {
    const lapses = scheduledMeetingEndTime(meeting) + SCHEDULED_MEETING_LATE_GRACE_MS;
    expect(isScheduledMeetingCurrent(meeting, lapses - 1)).toBe(true);
    expect(isScheduledMeetingCurrent(meeting, lapses)).toBe(false);
  });

  it('looks back far enough to catch the longest meeting still in grace', () => {
    // Eight hours of meeting plus twelve of grace, so the query cannot miss a
    // row the filter would have kept.
    expect(earliestPossibleCurrentMeetingStart(Date.parse('2026-08-14T17:30:00.000Z'))).toBe(
      '2026-08-13T21:30:00.000Z'
    );
  });
});
