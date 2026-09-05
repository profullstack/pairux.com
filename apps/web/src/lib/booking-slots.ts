/**
 * Which times a booking page can offer.
 *
 * The host writes availability as weekly windows in their own zone ("Monday
 * 9 to 5, Pacific"). A guest in Berlin sees instants. Everything in between
 * is this file, and it is pure so the arithmetic can be tested against a
 * clock and a zone rather than a database.
 *
 * Time zones are done with `Intl` alone — no library — because the only
 * operation needed is "this wall-clock time on this date in this zone is
 * which instant", and `Intl.DateTimeFormat` can answer that by telling us the
 * zone's offset at a guessed instant. Two iterations settle a DST boundary.
 */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface AvailabilityWindow {
  /** "HH:MM", 24-hour. */
  start: string;
  /** "HH:MM", 24-hour, exclusive; "24:00" means midnight at the end of the day. */
  end: string;
}

/** Weekly availability, keyed by day. A missing day has none. */
export type WeeklyAvailability = Partial<Record<DayKey, AvailabilityWindow[]>>;

export const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
};

export interface BusyInterval {
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
}

export interface SlotOptions {
  availability: WeeklyAvailability;
  /** IANA zone the availability is written in. */
  timezone: string;
  durationMinutes: number;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  maxDaysAhead?: number;
  /** First day to offer, as "YYYY-MM-DD" in the page's zone. Defaults to today there. */
  fromDate?: string;
  /** How many days to walk from `fromDate`. */
  days?: number;
  busy?: BusyInterval[];
  now?: Date;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Is this an IANA zone the runtime knows? */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const HHMM = /^(\d{1,2}):([0-5]\d)$/;

/** "09:30" or "9:30" → 570. Accepts "24:00" for end-of-day. */
export function parseHhMm(value: string): number | null {
  const match = HHMM.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 24 * 60 ? null : minutes;
}

/**
 * Availability as a host might paste it, checked and tidied.
 *
 * Windows are sorted, must not overlap, and must end after they start. The
 * error names the day so a form can point at the row.
 */
export function normalizeAvailability(input: unknown): WeeklyAvailability {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('availability must be an object keyed by day (mon … sun)');
  }
  const result: WeeklyAvailability = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const day = key.toLowerCase().slice(0, 3);
    if (!DAY_KEYS.includes(day as DayKey)) throw new Error(`unknown day "${key}"`);
    if (!Array.isArray(raw)) throw new Error(`${day}: expected a list of windows`);

    const windows: { start: number; end: number }[] = [];
    for (const entry of raw) {
      const window = entry as Partial<AvailabilityWindow> | null;
      const start = typeof window?.start === 'string' ? parseHhMm(window.start) : null;
      const end = typeof window?.end === 'string' ? parseHhMm(window.end) : null;
      if (start === null || end === null) throw new Error(`${day}: times must be HH:MM`);
      if (end <= start) throw new Error(`${day}: a window must end after it starts`);
      windows.push({ start, end });
    }
    windows.sort((a, b) => a.start - b.start);
    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const current = windows[index];
      if (previous && current && current.start < previous.end) {
        throw new Error(`${day}: windows overlap`);
      }
    }
    if (windows.length > 0) {
      result[day as DayKey] = windows.map((w) => ({
        start: minutesToHhMm(w.start),
        end: minutesToHhMm(w.end),
      }));
    }
  }
  return result;
}

export function minutesToHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let cached = formatters.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, cached);
  }
  return cached;
}

/** The wall clock in `zone` at this instant. */
export function wallClock(instantMs: number, zone: string): Parts {
  const parts: Partial<Parts> = {};
  for (const part of formatter(zone).formatToParts(new Date(instantMs))) {
    if (part.type === 'literal') continue;
    const value = Number(part.value);
    if (part.type === 'year') parts.year = value;
    else if (part.type === 'month') parts.month = value;
    else if (part.type === 'day') parts.day = value;
    // Some ICU builds print midnight as 24 under h23; fold it back.
    else if (part.type === 'hour') parts.hour = value === 24 ? 0 : value;
    else if (part.type === 'minute') parts.minute = value;
    else if (part.type === 'second') parts.second = value;
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** The zone's offset from UTC at this instant, in milliseconds (east positive). */
export function zoneOffsetMs(instantMs: number, zone: string): number {
  const wall = wallClock(instantMs, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Drop sub-second noise: the formatter has no milliseconds.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant at which `zone` reads this wall-clock time on this date.
 *
 * Two passes: guess the offset at the UTC reading of the wall time, correct,
 * and re-check the offset at the corrected instant, which is what settles a
 * time on the day the clocks change. A wall time that does not exist (the
 * skipped hour in spring) lands an hour later, which is what every calendar
 * does with it.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesIntoDay: number,
  zone: string
): number {
  const guess = Date.UTC(year, month - 1, day) + minutesIntoDay * MINUTE;
  const first = guess - zoneOffsetMs(guess, zone);
  const second = guess - zoneOffsetMs(first, zone);

  const readsBack = (instant: number): boolean => {
    const wall = wallClock(instant, zone);
    return (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour * 60 + wall.minute === minutesIntoDay
    );
  };
  // An unambiguous time, or the first of a repeated one in autumn.
  if (readsBack(first)) return first;
  if (readsBack(second)) return second;
  // Neither reads back: the wall time was skipped in spring. Take the later
  // candidate, which is the requested time plus the hour that went missing.
  return Math.max(first, second);
}

/** "YYYY-MM-DD" of the given instant, as seen in `zone`. */
export function localDate(instantMs: number, zone: string): string {
  const wall = wallClock(instantMs, zone);
  return `${String(wall.year)}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return null;
  return { year, month, day };
}

/** Calendar days from a "YYYY-MM-DD" start, as {year, month, day} in that calendar. */
function walkDays(from: { year: number; month: number; day: number }, count: number) {
  const out: { year: number; month: number; day: number; weekday: DayKey }[] = [];
  const base = Date.UTC(from.year, from.month - 1, from.day);
  for (let index = 0; index < count; index += 1) {
    const date = new Date(base + index * DAY);
    const weekday = DAY_KEYS[date.getUTCDay()];
    if (!weekday) continue;
    out.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekday,
    });
  }
  return out;
}

export interface Slot {
  /** ISO instant the meeting would start. */
  start: string;
  /** ISO instant it would end. */
  end: string;
}

/**
 * Every slot the page can offer in the window asked for.
 *
 * A slot is a start time where the whole meeting fits inside one availability
 * window, starts at least `minNoticeMinutes` from now, ends no later than
 * `maxDaysAhead` days out, and — with the buffer added on both sides — touches
 * nothing the host already has. Slots step by the meeting's own duration, so a
 * 30-minute page offers :00 and :30, never a :15 that would strand 15 minutes.
 */
export function computeSlots(options: SlotOptions): Slot[] {
  const {
    availability,
    timezone,
    durationMinutes,
    bufferMinutes = 0,
    minNoticeMinutes = 0,
    maxDaysAhead = 30,
    days = 7,
    busy = [],
  } = options;
  if (!isValidTimezone(timezone)) throw new Error(`unknown timezone "${timezone}"`);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('durationMinutes must be a positive integer');
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const fromDate = options.fromDate ?? localDate(nowMs, timezone);
  const from = parseYmd(fromDate);
  if (!from) throw new Error(`fromDate must be YYYY-MM-DD, got "${fromDate}"`);

  const earliestStart = nowMs + minNoticeMinutes * MINUTE;
  const latestEnd = nowMs + maxDaysAhead * DAY;
  const durationMs = durationMinutes * MINUTE;
  const bufferMs = bufferMinutes * MINUTE;

  const busyMs = busy
    .map((interval) => ({ start: Date.parse(interval.start), end: Date.parse(interval.end) }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end));

  const slots: Slot[] = [];
  for (const date of walkDays(from, Math.max(1, Math.min(days, 62)))) {
    const windows = availability[date.weekday] ?? [];
    for (const window of windows) {
      const startMinutes = parseHhMm(window.start);
      const endMinutes = parseHhMm(window.end);
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue;

      const windowStart = zonedTimeToUtc(date.year, date.month, date.day, startMinutes, timezone);
      const windowEnd = zonedTimeToUtc(date.year, date.month, date.day, endMinutes, timezone);

      for (let start = windowStart; start + durationMs <= windowEnd; start += durationMs) {
        const end = start + durationMs;
        if (start < earliestStart) continue;
        if (end > latestEnd) break;
        const guardedStart = start - bufferMs;
        const guardedEnd = end + bufferMs;
        const collides = busyMs.some(
          (interval) => interval.start < guardedEnd && interval.end > guardedStart
        );
        if (collides) continue;
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
    }
  }
  return slots;
}

/**
 * Is this exact instant one the page would offer right now?
 *
 * Used at booking time, after the guest picked from a list that may be
 * minutes old: the answer has to come from the same rules, against the
 * current busy list, or two guests can take one slot.
 */
export function isSlotAvailable(startIso: string, options: SlotOptions): boolean {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return false;
  const fromDate = localDate(startMs - DAY, options.timezone);
  const slots = computeSlots({ ...options, fromDate, days: 3 });
  return slots.some((slot) => Date.parse(slot.start) === startMs);
}

/** Group slots by the calendar day the guest will see them on. */
export function groupSlotsByDay(slots: Slot[], zone: string): { date: string; slots: Slot[] }[] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = localDate(Date.parse(slot.start), zone);
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([date, list]) => ({ date, slots: list }));
}
