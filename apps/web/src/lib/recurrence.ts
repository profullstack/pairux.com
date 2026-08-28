/**
 * Recurring scheduled meetings.
 *
 * A recurring meeting is a single `scheduled_sessions` row, not one row per
 * occurrence: it keeps one join code, one invitee list and one set of emails for
 * the whole series. `scheduled_at` always points at the *next* occurrence and is
 * rolled forward lazily (see `lib/recurrence-rollforward.ts`) once an occurrence
 * has finished, so no cron job is needed.
 */

import { SCHEDULED_MEETING_LATE_GRACE_MS } from './scheduled-meeting-timing';

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly';

export const RECURRENCE_FREQUENCIES: RecurrenceFreq[] = ['daily', 'weekly', 'monthly'];

export const MAX_RECURRENCE_INTERVAL = 30;
export const MAX_RECURRENCE_COUNT = 365;

export interface RecurrenceRule {
  /** null means the meeting happens once. */
  freq: RecurrenceFreq | null;
  /** Repeat every N days/weeks/months. */
  interval: number;
  /** Total number of occurrences; 0 means it repeats forever. */
  count: number;
}

export const NO_RECURRENCE: RecurrenceRule = { freq: null, interval: 1, count: 0 };

const UNIT_LABEL: Record<RecurrenceFreq, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
};

const RRULE_FREQ: Record<RecurrenceFreq, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * The occurrence after `from`.
 *
 * Arithmetic is deliberately done in local (wall clock) time so a 9am standup
 * stays at 9am across a daylight-saving change. `anchorDayOfMonth` is the day of
 * the month the series was booked on: monthly meetings step from that day and
 * clamp to the length of the target month, so a series booked on the 31st lands
 * on the 28th of February without permanently losing its day.
 */
export function nextOccurrence(
  from: Date,
  freq: RecurrenceFreq,
  interval: number,
  anchorDayOfMonth?: number
): Date {
  const step = Math.max(1, Math.trunc(interval));
  const next = new Date(from.getTime());

  if (freq === 'daily') {
    next.setDate(next.getDate() + step);
    return next;
  }

  if (freq === 'weekly') {
    next.setDate(next.getDate() + step * 7);
    return next;
  }

  const targetDay = anchorDayOfMonth ?? from.getDate();
  // Move to the 1st first: setMonth() on the 31st would otherwise overflow into
  // the month after next.
  next.setDate(1);
  next.setMonth(next.getMonth() + step);
  next.setDate(Math.min(targetDay, daysInMonth(next.getFullYear(), next.getMonth())));
  return next;
}

export interface SeriesState {
  scheduledAt: Date;
  durationMinutes: number;
  /** The first occurrence — fixes the day of the month for monthly series. */
  anchorAt: Date;
  freq: RecurrenceFreq;
  interval: number;
  /** 0 = unlimited. */
  count: number;
  /** Occurrences that have already finished. */
  elapsed: number;
}

export interface SeriesAdvance {
  scheduledAt: Date;
  elapsed: number;
  /** The series ran out of occurrences — the meeting is done. */
  completed: boolean;
}

/** How many steps we will walk in one roll-forward before giving up. */
const MAX_ADVANCE_STEPS = 10_000;

/**
 * Roll a series forward to its next unfinished occurrence.
 *
 * Returns null when nothing changed — the current occurrence has not ended yet,
 * or the series already ran out.
 *
 * An occurrence is not retired the moment its booked minutes are up. Rolling
 * forward is how a series forgets an occurrence: `scheduled_at` moves and the
 * room it was held in is dropped, so a weekly sync that ran over — or started
 * late, or has not started at all because the host is running behind — would
 * become next week's meeting while its host was still trying to open it. It
 * keeps its slot for `SCHEDULED_MEETING_LATE_GRACE_MS`, and never past the
 * point where the next occurrence is itself due.
 */
export function advanceSeries(state: SeriesState, now: Date): SeriesAdvance | null {
  const step = Math.max(1, Math.trunc(state.interval));
  const anchorDay = state.anchorAt.getDate();

  let scheduledAt = state.scheduledAt;
  let elapsed = state.elapsed;
  let changed = false;

  for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
    const endsAt = scheduledAt.getTime() + state.durationMinutes * 60_000;
    const nextAt = nextOccurrence(scheduledAt, state.freq, step, anchorDay);
    const lapsesAt = Math.min(endsAt + SCHEDULED_MEETING_LATE_GRACE_MS, nextAt.getTime());
    if (lapsesAt > now.getTime()) break;

    elapsed += 1;
    changed = true;

    // A bounded series stops on its last occurrence rather than rolling past it.
    if (state.count > 0 && elapsed >= state.count) {
      return { scheduledAt, elapsed, completed: true };
    }

    scheduledAt = nextAt;
  }

  return changed ? { scheduledAt, elapsed, completed: false } : null;
}

/** How many occurrences are left, including the next one. null = unlimited. */
export function occurrencesRemaining(count: number, elapsed: number): number | null {
  if (count <= 0) return null;
  return Math.max(0, count - elapsed);
}

/**
 * "Repeats every 2 weeks on Tuesday, 8 times" — the sentence shown under the
 * recurrence controls and in invite emails.
 */
export function describeRecurrence(rule: RecurrenceRule, startsAt?: Date | null): string {
  if (!rule.freq) return 'Does not repeat';

  const step = Math.max(1, Math.trunc(rule.interval));
  const unit = UNIT_LABEL[rule.freq];
  const every = step === 1 ? `every ${unit}` : `every ${String(step)} ${unit}s`;

  let when = '';
  if (startsAt && !isNaN(startsAt.getTime())) {
    if (rule.freq === 'weekly') {
      when = ` on ${startsAt.toLocaleDateString('en-US', { weekday: 'long' })}`;
    } else if (rule.freq === 'monthly') {
      when = ` on day ${String(startsAt.getDate())}`;
    }
  }

  const times =
    rule.count > 0 ? `, ${String(rule.count)} time${rule.count === 1 ? '' : 's'}` : ', forever';

  return `Repeats ${every}${when}${times}`;
}

/** Short form for list rows and badges: "Weekly", "Every 2 weeks". */
export function shortRecurrenceLabel(rule: RecurrenceRule): string | null {
  if (!rule.freq) return null;
  const step = Math.max(1, Math.trunc(rule.interval));
  if (step === 1) {
    return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[rule.freq];
  }
  return `Every ${String(step)} ${UNIT_LABEL[rule.freq]}s`;
}

/**
 * The iCalendar RRULE for the series, without the "RRULE:" prefix. Used by both
 * the .ics download and the Google Calendar link.
 */
export function buildRrule(rule: RecurrenceRule): string | null {
  if (!rule.freq) return null;
  const step = Math.max(1, Math.trunc(rule.interval));
  const parts = [`FREQ=${RRULE_FREQ[rule.freq]}`];
  if (step > 1) parts.push(`INTERVAL=${String(step)}`);
  if (rule.count > 0) parts.push(`COUNT=${String(rule.count)}`);
  return parts.join(';');
}

/** The recurrence columns of a scheduled_sessions row. */
export interface RecurrenceRow {
  recurrence_freq?: string | null;
  recurrence_interval?: number | null;
  recurrence_count?: number | null;
}

/** Read a recurrence rule off a scheduled_sessions row (or anything shaped like one). */
export function ruleFromRow(row: RecurrenceRow): RecurrenceRule {
  const freq = RECURRENCE_FREQUENCIES.includes(row.recurrence_freq as RecurrenceFreq)
    ? (row.recurrence_freq as RecurrenceFreq)
    : null;
  return {
    freq,
    interval: row.recurrence_interval ?? 1,
    count: row.recurrence_count ?? 0,
  };
}
