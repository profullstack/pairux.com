/**
 * When a meeting reminder is due, and what it is called.
 *
 * Deliberately free of database and network so the awkward part -- deciding
 * whether a given meeting deserves a message right now -- can be tested without
 * a Supabase instance or a clock that really has to pass.
 */

/** The four lead times, longest first. Minutes before the meeting starts. */
export const LEAD_MINUTES = [1440, 60, 15, 1] as const;

export type LeadMinutes = (typeof LEAD_MINUTES)[number];

/**
 * The preference key that governs a lead time, in `profiles.settings.notifications`.
 *
 * One key per lead time rather than one for reminders as a whole, because the
 * point of the feature is that somebody can keep the day-before nudge and drop
 * the one that fires while they are already walking to their desk.
 */
export const REMINDER_PREF_KEYS = {
  1440: 'meetingReminder1Day',
  60: 'meetingReminder1Hour',
  15: 'meetingReminder15Min',
  1: 'meetingReminder1Min',
} as const satisfies Record<LeadMinutes, string>;

export type ReminderPrefKey = (typeof REMINDER_PREF_KEYS)[LeadMinutes];

/** Human labels, used in the settings UI and in the subject line. */
export const LEAD_LABELS = {
  1440: '1 day',
  60: '1 hour',
  15: '15 minutes',
  1: '1 minute',
} as const satisfies Record<LeadMinutes, string>;

/**
 * Which single lead time, if any, is due for a meeting right now.
 *
 * The rule is a partition rather than a window with a tolerance: a lead is due
 * while the time remaining falls between it and the next tighter lead. So the
 * day-before reminder owns everything from 24 hours down to 1 hour, the
 * hour-before owns 60 to 15 minutes, and so on.
 *
 * That is worth the paragraph, because the obvious implementation -- fire when
 * `now` is within a minute or two of `start - lead` -- fails in both directions
 * at once. If the runner misses its window (a deploy, a slow tick, a database
 * blip) the reminder is lost with no way to notice; and widening the tolerance
 * to compensate starts sending the hour-before notice twenty minutes late, when
 * the fifteen-minute one is about to say something more accurate anyway.
 *
 * With bands there is no tolerance to tune. A runner that has been down for
 * three hours comes back and sends the tightest reminder that is still true,
 * which is the one worth sending; the ones it slept through are skipped, which
 * is what should happen to a reminder about something that has since drawn much
 * closer.
 *
 * Returns the *widest* due lead the recipient has not been sent yet -- the
 * caller supplies that set -- so a first run inside the 15-minute band does not
 * also fire the day and hour reminders it slept through.
 *
 * @param startsAt when the meeting (or this occurrence of it) begins
 * @param now
 * @param alreadySent lead times already recorded for this occurrence + recipient
 * @returns the lead to send, or null when nothing is due
 */
export function dueLead(
  startsAt: Date,
  now: Date,
  alreadySent: ReadonlySet<number> = new Set()
): LeadMinutes | null {
  const remainingMs = startsAt.getTime() - now.getTime();

  // Already started, or already over. A reminder for a meeting that has begun
  // is not a reminder, and this is the guard that keeps a stalled runner from
  // mailing everybody about yesterday when it wakes up.
  if (remainingMs <= 0) return null;

  const remaining = remainingMs / 60_000;

  // `entries()` rather than an index loop: it hands back the element already
  // typed, where `LEAD_MINUTES[i]` needs either a cast or a `!` to convince the
  // compiler it exists, and this codebase's lint forbids both.
  for (const [i, lead] of LEAD_MINUTES.entries()) {
    // The floor of this lead's band is the next tighter lead, or zero for the
    // last one. Exclusive at the bottom so the bands cannot both claim an
    // instant, inclusive at the top so a meeting exactly a day out fires.
    const floor: number = LEAD_MINUTES[i + 1] ?? 0;

    if (remaining <= lead && remaining > floor) {
      return alreadySent.has(lead) ? null : lead;
    }
  }

  // Further out than the widest lead: nothing to say yet.
  return null;
}

/**
 * How long until the meeting, in words, for the message itself.
 *
 * The band a reminder belongs to is not necessarily what the recipient should
 * be told. A meeting created twenty-five minutes before it starts falls in the
 * hour band, and "starting in 1 hour" would simply be false. This says what is
 * actually true at the moment of sending.
 *
 * @param startsAt
 * @param now
 */
export function timeUntil(startsAt: Date, now: Date): string {
  const minutes = Math.round((startsAt.getTime() - now.getTime()) / 60_000);

  if (minutes <= 1) return 'in about a minute';
  if (minutes < 60) return `in ${String(minutes)} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'in about an hour' : `in about ${String(hours)} hours`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${String(days)} days`;
}

/**
 * Whether a recipient wants this lead time.
 *
 * Absent means yes. Every preference in this product defaults on -- see
 * `DEFAULT_PREFERENCES` in push.ts -- and a reminder that silently did nothing
 * because a key had not been written yet would be indistinguishable from the
 * feature being broken.
 *
 * @param settings the `notifications` object out of `profiles.settings`
 * @param lead
 */
export function wantsReminder(
  settings: Record<string, unknown> | null | undefined,
  lead: LeadMinutes
): boolean {
  const key = REMINDER_PREF_KEYS[lead];
  const value = settings?.[key];
  return value === undefined || value === null ? true : value !== false;
}
