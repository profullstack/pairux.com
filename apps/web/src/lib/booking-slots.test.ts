import { describe, expect, it } from 'vitest';

import {
  computeSlots,
  groupSlotsByDay,
  isSlotAvailable,
  isValidTimezone,
  localDate,
  normalizeAvailability,
  parseHhMm,
  zoneOffsetMs,
  zonedTimeToUtc,
} from './booking-slots';

const PACIFIC = 'America/Los_Angeles';

describe('time zone arithmetic', () => {
  it('knows a real zone from a made-up one', () => {
    expect(isValidTimezone(PACIFIC)).toBe(true);
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
  });

  it('reads the offset on both sides of daylight saving', () => {
    // 2026-07-01 is PDT (UTC-7); 2026-01-15 is PST (UTC-8).
    expect(zoneOffsetMs(Date.UTC(2026, 6, 1, 12), PACIFIC)).toBe(-7 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), PACIFIC)).toBe(-8 * 3_600_000);
  });

  it('turns a wall-clock time into the instant that zone means', () => {
    // 9am Pacific on a July day is 16:00Z.
    expect(new Date(zonedTimeToUtc(2026, 7, 6, 9 * 60, PACIFIC)).toISOString()).toBe(
      '2026-07-06T16:00:00.000Z'
    );
    // Same wall time in January is 17:00Z.
    expect(new Date(zonedTimeToUtc(2026, 1, 12, 9 * 60, PACIFIC)).toISOString()).toBe(
      '2026-01-12T17:00:00.000Z'
    );
    // UTC is the identity.
    expect(zonedTimeToUtc(2026, 3, 1, 90, 'UTC')).toBe(Date.UTC(2026, 2, 1, 1, 30));
  });

  // 2026-03-08 02:30 does not exist in Los Angeles; calendars put it at 03:30.
  it('lands a skipped spring-forward time an hour later, not on a different day', () => {
    const instant = zonedTimeToUtc(2026, 3, 8, 2 * 60 + 30, PACIFIC);
    expect(localDate(instant, PACIFIC)).toBe('2026-03-08');
    expect(new Date(instant).toISOString()).toBe('2026-03-08T10:30:00.000Z');
  });

  it('names the local calendar day of an instant', () => {
    // 03:00Z on the 7th is still the evening of the 6th in Los Angeles.
    expect(localDate(Date.UTC(2026, 6, 7, 3), PACIFIC)).toBe('2026-07-06');
    expect(localDate(Date.UTC(2026, 6, 7, 3), 'Europe/Berlin')).toBe('2026-07-07');
  });
});

describe('normalizeAvailability', () => {
  it('parses times, sorts windows and drops empty days', () => {
    expect(
      normalizeAvailability({
        Monday: [
          { start: '13:00', end: '17:00' },
          { start: '9:00', end: '12:00' },
        ],
        tue: [],
      })
    ).toEqual({
      mon: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
    });
    expect(parseHhMm('9:00')).toBe(540);
    expect(parseHhMm('24:00')).toBe(1440);
    expect(parseHhMm('25:00')).toBeNull();
    expect(parseHhMm('9am')).toBeNull();
  });

  it('refuses what a form must catch: bad day, bad time, inverted or overlapping windows', () => {
    expect(() => normalizeAvailability({ funday: [] })).toThrow(/unknown day/);
    expect(() => normalizeAvailability({ mon: [{ start: '9am', end: '17:00' }] })).toThrow(/HH:MM/);
    expect(() => normalizeAvailability({ mon: [{ start: '17:00', end: '09:00' }] })).toThrow(
      /end after/
    );
    expect(() =>
      normalizeAvailability({
        mon: [
          { start: '09:00', end: '12:00' },
          { start: '11:00', end: '13:00' },
        ],
      })
    ).toThrow(/overlap/);
    expect(() => normalizeAvailability([])).toThrow(/keyed by day/);
  });
});

describe('computeSlots', () => {
  // A Monday, 08:00 Pacific.
  const now = new Date('2026-07-06T15:00:00.000Z');
  const base = {
    availability: {
      mon: [{ start: '09:00', end: '11:00' }],
      wed: [{ start: '14:00', end: '15:00' }],
    },
    timezone: PACIFIC,
    durationMinutes: 30,
    now,
    fromDate: '2026-07-06',
    days: 7,
  };

  it('steps through each window by the duration, in the page zone, as instants', () => {
    const slots = computeSlots(base).map((slot) => slot.start);
    expect(slots).toEqual([
      '2026-07-06T16:00:00.000Z',
      '2026-07-06T16:30:00.000Z',
      '2026-07-06T17:00:00.000Z',
      '2026-07-06T17:30:00.000Z',
      '2026-07-08T21:00:00.000Z',
      '2026-07-08T21:30:00.000Z',
    ]);
  });

  it('honours minimum notice from now', () => {
    // 90 minutes of notice at 08:00 removes the 09:00 slot and keeps 09:30.
    const slots = computeSlots({ ...base, minNoticeMinutes: 90 }).map((slot) => slot.start);
    expect(slots[0]).toBe('2026-07-06T16:30:00.000Z');
  });

  it('stops offering beyond max days ahead', () => {
    const slots = computeSlots({ ...base, maxDaysAhead: 1 }).map((slot) => slot.start);
    expect(slots).toHaveLength(4);
    expect(slots.every((iso) => iso.startsWith('2026-07-06'))).toBe(true);
  });

  it('never offers a slot that would not fit the window', () => {
    // A 45-minute meeting in a 60-minute window: one slot, not two.
    const slots = computeSlots({
      ...base,
      durationMinutes: 45,
      availability: { wed: [{ start: '14:00', end: '15:00' }] },
    });
    expect(slots).toHaveLength(1);
  });

  // The reason the buffer exists: a call already at 09:30 must not let a
  // guest book 09:00 with a 15-minute buffer, because the two would touch.
  it('removes slots that collide with busy time, buffer included', () => {
    const busy = [{ start: '2026-07-06T16:30:00.000Z', end: '2026-07-06T17:00:00.000Z' }];
    expect(computeSlots({ ...base, busy }).map((slot) => slot.start)).toEqual([
      '2026-07-06T16:00:00.000Z',
      '2026-07-06T17:00:00.000Z',
      '2026-07-06T17:30:00.000Z',
      '2026-07-08T21:00:00.000Z',
      '2026-07-08T21:30:00.000Z',
    ]);
    expect(computeSlots({ ...base, busy, bufferMinutes: 15 }).map((slot) => slot.start)).toEqual([
      '2026-07-06T17:30:00.000Z',
      '2026-07-08T21:00:00.000Z',
      '2026-07-08T21:30:00.000Z',
    ]);
  });

  it('rejects a zone or duration it cannot work with', () => {
    expect(() => computeSlots({ ...base, timezone: 'Nowhere/Land' })).toThrow(/unknown timezone/);
    expect(() => computeSlots({ ...base, durationMinutes: 0 })).toThrow(/positive integer/);
    expect(() => computeSlots({ ...base, fromDate: '2026-13-01' })).toThrow(/YYYY-MM-DD/);
  });

  it('defaults fromDate to today in the page zone, not in UTC', () => {
    // 05:00Z on Tuesday is still Monday evening in Los Angeles, and Monday's
    // windows are over, so the first slot is Wednesday — never a Monday slot
    // from a "today" computed in UTC.
    const { fromDate: _fromDate, ...withoutFrom } = base;
    const slots = computeSlots({
      ...withoutFrom,
      now: new Date('2026-07-07T05:00:00.000Z'),
    });
    expect(slots[0]?.start).toBe('2026-07-08T21:00:00.000Z');
  });
});

describe('isSlotAvailable', () => {
  const options = {
    availability: { mon: [{ start: '09:00', end: '11:00' }] },
    timezone: PACIFIC,
    durationMinutes: 30,
    now: new Date('2026-07-06T15:00:00.000Z'),
  };

  it('accepts exactly a slot the page would offer and nothing else', () => {
    expect(isSlotAvailable('2026-07-06T16:30:00.000Z', options)).toBe(true);
    // Off-grid.
    expect(isSlotAvailable('2026-07-06T16:45:00.000Z', options)).toBe(false);
    // Taken since the guest loaded the page.
    expect(
      isSlotAvailable('2026-07-06T16:30:00.000Z', {
        ...options,
        busy: [{ start: '2026-07-06T16:30:00.000Z', end: '2026-07-06T17:00:00.000Z' }],
      })
    ).toBe(false);
    expect(isSlotAvailable('garbage', options)).toBe(false);
  });
});

describe('groupSlotsByDay', () => {
  it('groups by the guest zone, so a late-evening slot moves to the next day in Berlin', () => {
    const slots = [
      { start: '2026-07-06T16:00:00.000Z', end: '2026-07-06T16:30:00.000Z' },
      { start: '2026-07-06T23:30:00.000Z', end: '2026-07-07T00:00:00.000Z' },
    ];
    expect(groupSlotsByDay(slots, PACIFIC).map((group) => group.date)).toEqual(['2026-07-06']);
    expect(groupSlotsByDay(slots, 'Europe/Berlin').map((group) => group.date)).toEqual([
      '2026-07-06',
      '2026-07-07',
    ]);
  });
});
