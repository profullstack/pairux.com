import { describe, it, expect } from 'vitest';

import {
  dueLead,
  timeUntil,
  wantsReminder,
  LEAD_MINUTES,
  REMINDER_PREF_KEYS,
} from './meeting-reminders';

/** A fixed meeting time, so nothing here depends on when it runs. */
const START = new Date('2026-08-20T15:00:00.000Z');

/** `n` minutes before the meeting. */
const before = (n: number) => new Date(START.getTime() - n * 60_000);

describe('dueLead', () => {
  it('says nothing until the widest lead is reached', () => {
    expect(dueLead(START, before(2880))).toBeNull(); // two days out
    expect(dueLead(START, before(1441))).toBeNull(); // a minute too early
    expect(dueLead(START, before(1440))).toBe(1440); // exactly a day: fires
  });

  it('gives each lead a band rather than an instant', () => {
    // The whole point. A runner that ticks late, or is down for a while, still
    // finds the reminder that is currently true instead of missing it entirely.
    expect(dueLead(START, before(1440))).toBe(1440);
    expect(dueLead(START, before(600))).toBe(1440);
    expect(dueLead(START, before(61))).toBe(1440);

    expect(dueLead(START, before(60))).toBe(60);
    expect(dueLead(START, before(16))).toBe(60);

    expect(dueLead(START, before(15))).toBe(15);
    expect(dueLead(START, before(2))).toBe(15);

    expect(dueLead(START, before(1))).toBe(1);
    expect(dueLead(START, before(0.5))).toBe(1);
  });

  it('no two bands claim the same instant', () => {
    // Walk every minute of the day before the meeting and assert exactly one
    // answer at each. A gap would drop a reminder; an overlap would send two.
    for (let m = 1440; m >= 1; m -= 1) {
      const lead = dueLead(START, before(m));
      expect(lead, `at ${String(m)} minutes out`).not.toBeNull();
      expect(LEAD_MINUTES).toContain(lead);
    }
  });

  it('goes quiet once the meeting has started', () => {
    // The guard that stops a runner which has been asleep from mailing everyone
    // about a meeting that is over.
    expect(dueLead(START, START)).toBeNull();
    expect(dueLead(START, new Date(START.getTime() + 60_000))).toBeNull();
    expect(dueLead(START, new Date(START.getTime() + 86_400_000))).toBeNull();
  });

  it('does not re-send a lead already recorded for this occurrence', () => {
    // The ledger's answer feeds back in here: inside the day band, having
    // already sent the day reminder means silence rather than the next one down.
    expect(dueLead(START, before(600), new Set([1440]))).toBeNull();
    // ...but the hour band is a different slot and still fires.
    expect(dueLead(START, before(30), new Set([1440]))).toBe(60);
  });

  it('a meeting scheduled inside a band starts at that band, not the widest', () => {
    // Booked 25 minutes ahead: it should get the hour-band reminder and never
    // pretend a day's notice was given.
    expect(dueLead(START, before(25))).toBe(60);
    expect(dueLead(START, before(25), new Set([1440]))).toBe(60);
  });
});

describe('timeUntil', () => {
  it('describes the real remaining time, not the band', () => {
    // A meeting booked 25 minutes out sends from the hour band; saying "in 1
    // hour" would simply be false, so the copy uses this instead.
    expect(timeUntil(START, before(25))).toBe('in 25 minutes');
    expect(timeUntil(START, before(60))).toBe('in about an hour');
    expect(timeUntil(START, before(180))).toBe('in about 3 hours');
    expect(timeUntil(START, before(1440))).toBe('tomorrow');
    expect(timeUntil(START, before(2880))).toBe('in 2 days');
    expect(timeUntil(START, before(1))).toBe('in about a minute');
    expect(timeUntil(START, before(0.4))).toBe('in about a minute');
  });
});

describe('wantsReminder', () => {
  it('defaults to on when the preference has never been written', () => {
    // Every preference in this product defaults on, and a reminder that stayed
    // silent because a key was missing would look exactly like a broken feature.
    expect(wantsReminder(undefined, 1440)).toBe(true);
    expect(wantsReminder(null, 60)).toBe(true);
    expect(wantsReminder({}, 15)).toBe(true);
    expect(wantsReminder({ somethingElse: false }, 1)).toBe(true);
  });

  it('only false turns one off', () => {
    expect(wantsReminder({ meetingReminder1Day: false }, 1440)).toBe(false);
    expect(wantsReminder({ meetingReminder1Day: true }, 1440)).toBe(true);
  });

  it('each lead has its own key, so they are independent', () => {
    const off = { meetingReminder1Min: false };
    expect(wantsReminder(off, 1)).toBe(false);
    expect(wantsReminder(off, 15)).toBe(true);
    expect(wantsReminder(off, 60)).toBe(true);
    expect(wantsReminder(off, 1440)).toBe(true);
  });

  it('every lead maps to a distinct preference key', () => {
    const keys = Object.values(REMINDER_PREF_KEYS);
    expect(new Set(keys).size).toBe(LEAD_MINUTES.length);
  });
});
