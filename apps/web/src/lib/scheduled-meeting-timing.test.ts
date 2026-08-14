import { describe, expect, it } from 'vitest';
import {
  earliestPossibleCurrentMeetingStart,
  isScheduledMeetingCurrent,
  isScheduledMeetingStartable,
  scheduledMeetingEndTime,
} from './scheduled-meeting-timing';

const meeting = {
  scheduled_at: '2026-08-14T17:00:00.000Z',
  duration_minutes: 60,
};

describe('scheduled meeting timing', () => {
  it('keeps a meeting current until its scheduled duration ends', () => {
    expect(isScheduledMeetingCurrent(meeting, Date.parse('2026-08-14T17:59:59.999Z'))).toBe(true);
    expect(isScheduledMeetingCurrent(meeting, Date.parse('2026-08-14T18:00:00.000Z'))).toBe(false);
    expect(scheduledMeetingEndTime(meeting)).toBe(Date.parse('2026-08-14T18:00:00.000Z'));
  });

  it('allows the host to start 15 minutes early through the scheduled end', () => {
    expect(isScheduledMeetingStartable(meeting, Date.parse('2026-08-14T16:44:59.999Z'))).toBe(
      false
    );
    expect(isScheduledMeetingStartable(meeting, Date.parse('2026-08-14T16:45:00.000Z'))).toBe(true);
    expect(isScheduledMeetingStartable(meeting, Date.parse('2026-08-14T17:30:00.000Z'))).toBe(true);
    expect(isScheduledMeetingStartable(meeting, Date.parse('2026-08-14T18:00:00.000Z'))).toBe(
      false
    );
  });

  it('uses the maximum allowed duration as the upcoming-query lookback', () => {
    expect(earliestPossibleCurrentMeetingStart(Date.parse('2026-08-14T17:30:00.000Z'))).toBe(
      '2026-08-14T09:30:00.000Z'
    );
  });
});
