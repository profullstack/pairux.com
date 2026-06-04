export interface CalendarEvent {
  title: string;
  description: string | null;
  startIso: string;
  durationMinutes: number;
  joinUrl: string;
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

export function downloadIcs(event: CalendarEvent): void {
  const start = new Date(event.startIso);
  const end = new Date(start.getTime() + event.durationMinutes * 60000);
  const desc = [event.description, `Join at: ${event.joinUrl}`].filter(Boolean).join('\\n\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PairUX//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmtIcs(start)}`,
    `DTEND:${fmtIcs(end)}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${event.joinUrl}`,
    `URL:${event.joinUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.replace(/[^a-z0-9]/gi, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
