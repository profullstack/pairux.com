import { describe, it, expect } from 'vitest';
import { acceptedCount, isEarly, isLive, orderForPicker, relativeStart } from './meetingTiming';
import type { ScheduledMeeting } from '../../preload/api';

function meeting(overrides: Partial<ScheduledMeeting> = {}): ScheduledMeeting {
  return {
    id: 'm1',
    title: 'Weekly Sync',
    description: null,
    scheduled_at: '2026-09-01T15:00:00.000Z',
    duration_minutes: 60,
    join_code: 'ABC123',
    status: 'pending',
    session_id: null,
    started_at: null,
    recurrence_freq: null,
    invitee_count: 0,
    invitees: [],
    ...overrides,
  };
}

const at = (iso: string) => Date.parse(iso);

describe('isEarly', () => {
  it('is true only before the booked start', () => {
    const m = meeting();
    expect(isEarly(m, at('2026-09-01T14:59:59.999Z'))).toBe(true);
    expect(isEarly(m, at('2026-09-01T15:00:00.000Z'))).toBe(false);
    // Two hours late is not early — and is still perfectly startable.
    expect(isEarly(m, at('2026-09-01T17:00:00.000Z'))).toBe(false);
  });
});

describe('isLive', () => {
  it('needs both a start stamp and time still on the clock', () => {
    expect(isLive(meeting(), at('2026-09-01T15:10:00.000Z'))).toBe(false);

    const started = meeting({ started_at: '2026-09-01T15:00:10.000Z' });
    expect(isLive(started, at('2026-09-01T15:10:00.000Z'))).toBe(true);
    expect(isLive(started, at('2026-09-01T16:10:00.000Z'))).toBe(false);
  });

  it('gives a late start its full length rather than the rest of the booking', () => {
    // Booked 15:00-16:00, opened at 17:00: live until 18:00, not already over.
    const late = meeting({ started_at: '2026-09-01T17:00:00.000Z' });
    expect(isLive(late, at('2026-09-01T17:45:00.000Z'))).toBe(true);
    expect(isLive(late, at('2026-09-01T18:00:00.000Z'))).toBe(false);
  });
});

describe('relativeStart', () => {
  it('reads as a distance in either direction', () => {
    const m = meeting();
    expect(relativeStart(m, at('2026-09-01T14:40:00.000Z'))).toBe('in 20 minutes');
    expect(relativeStart(m, at('2026-09-01T14:00:00.000Z'))).toBe('in 1 hour');
    expect(relativeStart(m, at('2026-09-01T15:05:00.000Z'))).toBe('5 minutes ago');
    expect(relativeStart(m, at('2026-09-01T15:00:20.000Z'))).toBe('now');
  });
});

describe('orderForPicker', () => {
  it('puts the running meeting first, then the soonest', () => {
    const now = at('2026-09-01T15:30:00.000Z');
    const later = meeting({ id: 'later', scheduled_at: '2026-09-01T18:00:00.000Z' });
    const soon = meeting({ id: 'soon', scheduled_at: '2026-09-01T16:00:00.000Z' });
    const live = meeting({
      id: 'live',
      scheduled_at: '2026-09-01T15:00:00.000Z',
      started_at: '2026-09-01T15:01:00.000Z',
    });

    expect(orderForPicker([later, soon, live], now).map((m) => m.id)).toEqual([
      'live',
      'soon',
      'later',
    ]);
  });
});

describe('acceptedCount', () => {
  it('counts only the yeses', () => {
    const m = meeting({
      invitee_count: 3,
      invitees: [
        { id: 'a', email: 'a@example.com', name: null, rsvp_status: 'accepted' },
        { id: 'b', email: 'b@example.com', name: null, rsvp_status: 'pending' },
        { id: 'c', email: 'c@example.com', name: null, rsvp_status: 'declined' },
      ],
    });
    expect(acceptedCount(m)).toBe(1);
  });
});
