import { buildRrule, type RecurrenceRule } from './recurrence';

export interface CalendarEvent {
  title: string;
  description: string | null;
  startIso: string;
  durationMinutes: number;
  joinUrl: string;
  /** Set for a repeating meeting so the event lands as a series, not one date. */
  recurrence?: RecurrenceRule | undefined;
  /** Stable identifier so re-imports update the same calendar entry. */
  uid?: string | undefined;
}

function fmtIcs(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const details = [event.description, `Join at: ${event.joinUrl}`].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${fmtIcs(start)}/${fmtIcs(end)}`,
    details,
    location: event.joinUrl,
  });
  const rrule = event.recurrence ? buildRrule(event.recurrence) : null;
  if (rrule) params.set('recur', `RRULE:${rrule}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildOutlookUrl(event: CalendarEvent): string {
  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const body = [event.description, `Join at: ${event.joinUrl}`].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    subject: event.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body,
    location: event.joinUrl,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets, as RFC 5545 requires of long lines. */
function foldIcsLine(line: string): string {
  const octets = (s: string): number => new TextEncoder().encode(s).length;
  const out: string[] = [];
  let rest = line;
  while (octets(rest) > 75) {
    let cut = 75;
    // Never split a multi-byte character.
    while (cut > 0 && octets(rest.slice(0, cut)) > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * The iCalendar document for an event, usable as a download in the browser or
 * an attachment in an email. `now` stamps the file; pass it for deterministic
 * output.
 */
export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const desc = [event.description, `Join at: ${event.joinUrl}`].filter(Boolean).join('\n\n');
  const rrule = event.recurrence ? buildRrule(event.recurrence) : null;
  const uid = event.uid ?? `${event.joinUrl.replace(/[^a-z0-9]/gi, '-')}@pairux.com`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PairUX//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmtIcs(now)}`,
    `DTSTART:${fmtIcs(start)}`,
    `DTEND:${fmtIcs(end)}`,
    ...(rrule ? [`RRULE:${rrule}`] : []),
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(desc)}`,
    `LOCATION:${escapeIcsText(event.joinUrl)}`,
    `URL:${event.joinUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

export function icsFilename(title: string): string {
  return `${title.replace(/[^a-z0-9]/gi, '-')}.ics`;
}

export function downloadIcs(event: CalendarEvent): void {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFilename(event.title);
  a.click();
  URL.revokeObjectURL(url);
}
