/**
 * Public live events: scheduled meetings a host listed on its broadcast channel.
 * Rows come from the SECURITY DEFINER RPCs list_channel_events /
 * get_public_event / list_upcoming_public_events, which return public fields
 * only (no join code, invitees or host id).
 *
 * scheduled_at is rolled forward lazily (when the host lists their meetings),
 * so a row read here may still point at an occurrence that already happened.
 * Everything a viewer sees goes through `viewerOccurrence`.
 */
import type { CalendarEvent } from '@/lib/calendar';
import {
  advanceSeries,
  nextOccurrence,
  occurrencesRemaining,
  ruleFromRow,
  type RecurrenceFreq,
  type RecurrenceRule,
} from '@/lib/recurrence';

export interface PublicEventRow {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  recurrence_freq: string | null;
  recurrence_interval: number | null;
  recurrence_count: number | null;
  occurrences_elapsed: number | null;
  recurrence_anchor_at: string | null;
  updated_at: string | null;
  channel_handle: string;
  channel_name: string;
  channel_avatar_url: string | null;
}

export interface ViewerOccurrence {
  /** Start of the occurrence a viewer should see: live now, or the next one. */
  startsAt: Date;
  endsAt: Date;
  /** Occurrences left including this one; null = repeats forever. */
  remaining: number | null;
  liveNow: boolean;
}

const isFreq = (f: string | null): f is RecurrenceFreq =>
  f === 'daily' || f === 'weekly' || f === 'monthly';

/**
 * The occurrence to show a viewer at `now`, or null when the event is over.
 * A one-off is shown until it ends. A series is shown on its current
 * occurrence until that ends, then on the next one.
 */
export function viewerOccurrence(row: PublicEventRow, now: Date): ViewerOccurrence | null {
  const durMs = Math.max(1, row.duration_minutes) * 60_000;
  const scheduled = new Date(row.scheduled_at);
  if (Number.isNaN(scheduled.getTime())) return null;

  if (!isFreq(row.recurrence_freq)) {
    const endsAt = new Date(scheduled.getTime() + durMs);
    if (endsAt <= now) return null;
    return { startsAt: scheduled, endsAt, remaining: 1, liveNow: scheduled <= now };
  }

  const freq = row.recurrence_freq;
  const interval = Math.max(1, row.recurrence_interval ?? 1);
  const count = Math.max(0, row.recurrence_count ?? 0);
  const anchor = row.recurrence_anchor_at ? new Date(row.recurrence_anchor_at) : scheduled;
  let elapsed = Math.max(0, row.occurrences_elapsed ?? 0);
  let startsAt = scheduled;

  // The host-side roll-forward (12 h grace for a late host), without writing.
  const advanced = advanceSeries(
    {
      scheduledAt: scheduled,
      durationMinutes: row.duration_minutes,
      anchorAt: anchor,
      freq,
      interval,
      count,
      elapsed,
    },
    now
  );
  if (advanced) {
    if (advanced.completed) return null;
    startsAt = advanced.scheduledAt;
    elapsed = advanced.elapsed;
  }
  if (count > 0 && elapsed >= count) return null;

  // A viewer does not wait out the host's grace: once this occurrence has
  // ended, show the next one (if the series has one).
  if (startsAt.getTime() + durMs <= now.getTime()) {
    if (count > 0 && elapsed + 1 >= count) return null;
    startsAt = nextOccurrence(startsAt, freq, interval, anchor.getDate());
    elapsed += 1;
  }

  const endsAt = new Date(startsAt.getTime() + durMs);
  return {
    startsAt,
    endsAt,
    remaining: occurrencesRemaining(count, elapsed),
    liveNow: startsAt <= now,
  };
}

/** The series rule from the viewer's occurrence onward (COUNT = what is left). */
function ruleFrom(row: PublicEventRow, occ: ViewerOccurrence): RecurrenceRule | undefined {
  const rule = ruleFromRow({
    recurrence_freq: row.recurrence_freq,
    recurrence_interval: row.recurrence_interval,
    recurrence_count: row.recurrence_count,
  } as Parameters<typeof ruleFromRow>[0]);
  if (!rule.freq) return undefined;
  return { ...rule, count: occ.remaining ?? 0 };
}

export const eventUrl = (origin: string, id: string) => `${origin}/e/${id}`;
export const channelCalendarUrl = (origin: string, handle: string) =>
  `${origin}/c/${handle}/calendar.ics`;
export const channelWatchUrl = (origin: string, handle: string) => `${origin}/@${handle}`;

/** webcal:// makes calendar apps subscribe instead of importing once. */
export const webcalUrl = (httpsUrl: string) => httpsUrl.replace(/^https?:\/\//, 'webcal://');

/** Google Calendar's "add by URL" subscribe link for a feed. */
export const googleSubscribeUrl = (httpsUrl: string) =>
  `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(httpsUrl))}`;

/** A calendar entry for a public event, pointing at its public page. */
export function toCalendarEvent(
  row: PublicEventRow,
  occ: ViewerOccurrence,
  origin: string
): CalendarEvent {
  const watch = channelWatchUrl(origin, row.channel_handle);
  const description = [row.description, `Live on ${row.channel_name}: ${watch}`]
    .filter(Boolean)
    .join('\n\n');
  return {
    title: row.title,
    description,
    startIso: occ.startsAt.toISOString(),
    durationMinutes: row.duration_minutes,
    joinUrl: eventUrl(origin, row.id),
    recurrence: ruleFrom(row, occ),
    uid: `event-${row.id}@pairux.com`,
  };
}

/** Rows that still have something ahead, with their viewer occurrence, soonest first. */
export function upcoming(
  rows: PublicEventRow[],
  now: Date
): { row: PublicEventRow; occ: ViewerOccurrence }[] {
  return rows
    .map((row) => ({ row, occ: viewerOccurrence(row, now) }))
    .filter((x): x is { row: PublicEventRow; occ: ViewerOccurrence } => x.occ !== null)
    .sort((a, b) => a.occ.startsAt.getTime() - b.occ.startsAt.getTime());
}
