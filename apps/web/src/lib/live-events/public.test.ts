import { describe, expect, it } from 'vitest';
import { buildIcsFeed } from '@/lib/calendar';
import {
  googleSubscribeUrl,
  toCalendarEvent,
  upcoming,
  viewerOccurrence,
  webcalUrl,
  type PublicEventRow,
} from './public';

const row = (over: Partial<PublicEventRow> = {}): PublicEventRow => ({
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Weekly outreach',
  description: 'Office hours',
  scheduled_at: '2026-11-25T17:00:00Z',
  duration_minutes: 60,
  recurrence_freq: null,
  recurrence_interval: 1,
  recurrence_count: 0,
  occurrences_elapsed: 0,
  recurrence_anchor_at: '2026-11-25T17:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
  channel_handle: 'chovy',
  channel_name: 'Chovy',
  channel_avatar_url: null,
  ...over,
});
const at = (iso: string) => new Date(iso);

describe('viewerOccurrence: one-off', () => {
  it('is upcoming before it starts, live while it runs, gone once it ends', () => {
    expect(viewerOccurrence(row(), at('2026-11-24T00:00:00Z'))).toMatchObject({
      liveNow: false,
      remaining: 1,
    });
    expect(viewerOccurrence(row(), at('2026-11-25T17:30:00Z'))?.liveNow).toBe(true);
    expect(viewerOccurrence(row(), at('2026-11-25T18:00:00Z'))).toBeNull();
  });
});

describe('viewerOccurrence: series', () => {
  const weekly = row({ recurrence_freq: 'weekly' });

  it('shows the stored occurrence while it is still ahead', () => {
    const occ = viewerOccurrence(weekly, at('2026-11-24T00:00:00Z'))!;
    expect(occ.startsAt.toISOString()).toBe('2026-11-25T17:00:00.000Z');
    expect(occ.remaining).toBeNull();
  });

  it('moves on to next week as soon as this week ends (no 12 h host grace for viewers)', () => {
    const occ = viewerOccurrence(weekly, at('2026-11-25T18:30:00Z'))!;
    expect(occ.startsAt.toISOString()).toBe('2026-12-02T17:00:00.000Z');
    expect(occ.liveNow).toBe(false);
  });

  it('catches up a stale scheduled_at the host has not rolled forward', () => {
    const occ = viewerOccurrence(weekly, at('2026-12-20T00:00:00Z'))!;
    expect(occ.startsAt.toISOString()).toBe('2026-12-23T17:00:00.000Z');
  });

  it('stops after the last occurrence of a bounded series and counts down what is left', () => {
    const three = row({ recurrence_freq: 'weekly', recurrence_count: 3 });
    expect(viewerOccurrence(three, at('2026-11-24T00:00:00Z'))?.remaining).toBe(3);
    expect(viewerOccurrence(three, at('2026-11-26T00:00:00Z'))?.remaining).toBe(2);
    expect(viewerOccurrence(three, at('2026-12-09T17:30:00Z'))).toMatchObject({
      remaining: 1,
      liveNow: true,
    });
    expect(viewerOccurrence(three, at('2026-12-09T18:30:00Z'))).toBeNull();
  });

  it('handles daily series several days behind', () => {
    const daily = row({ recurrence_freq: 'daily' });
    expect(viewerOccurrence(daily, at('2026-11-29T20:00:00Z'))?.startsAt.toISOString()).toBe(
      '2026-11-30T17:00:00.000Z'
    );
  });

  it('treats a garbage date as no event', () => {
    expect(viewerOccurrence(row({ scheduled_at: 'nope' }), at('2026-11-24T00:00:00Z'))).toBeNull();
  });
});

describe('calendar output', () => {
  it('points at the public page, never a join code, with a stable uid and remaining COUNT', () => {
    const three = row({ recurrence_freq: 'weekly', recurrence_count: 3 });
    const occ = viewerOccurrence(three, at('2026-11-26T00:00:00Z'))!;
    const cal = toCalendarEvent(three, occ, 'https://pairux.com');
    expect(cal.joinUrl).toBe('https://pairux.com/e/11111111-2222-3333-4444-555555555555');
    expect(cal.uid).toBe('event-11111111-2222-3333-4444-555555555555@pairux.com');
    expect(cal.startIso).toBe('2026-12-02T17:00:00.000Z');
    expect(cal.recurrence).toEqual({ freq: 'weekly', interval: 1, count: 2 });
    expect(cal.description).toContain('https://pairux.com/@chovy');
    const ics = buildIcsFeed({ name: 'Chovy live' }, [cal]);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;COUNT=2');
    expect(ics).toContain('DTSTART:20261202T170000Z');
  });

  it('lists only events with something ahead, soonest first', () => {
    const rows = [
      row({ id: 'a', scheduled_at: '2026-12-10T10:00:00Z' }),
      row({ id: 'b', scheduled_at: '2026-11-01T10:00:00Z' }),
      row({ id: 'c', scheduled_at: '2026-11-30T10:00:00Z' }),
    ];
    expect(upcoming(rows, at('2026-11-22T00:00:00Z')).map((x) => x.row.id)).toEqual(['c', 'a']);
  });

  it('builds subscribe links', () => {
    expect(webcalUrl('https://pairux.com/c/chovy/calendar.ics')).toBe(
      'webcal://pairux.com/c/chovy/calendar.ics'
    );
    expect(googleSubscribeUrl('https://pairux.com/c/x/calendar.ics')).toBe(
      'https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fpairux.com%2Fc%2Fx%2Fcalendar.ics'
    );
  });
});
