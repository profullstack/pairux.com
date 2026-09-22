import { describe, it, expect } from 'vitest';

import { buildGoogleCalendarUrl, buildIcs, buildOutlookUrl, icsFilename } from './calendar';

const event = {
  title: 'Pairux 3+ particpant test mac/win',
  description: null,
  startIso: '2026-09-22T09:00:00.000Z',
  durationMinutes: 60,
  joinUrl: 'https://pairux.com/join/U1U2JJ',
  uid: 'abc-123@pairux.com',
};
const stamp = new Date('2026-09-22T08:00:00.000Z');

describe('buildIcs', () => {
  it('produces a single VEVENT with the meeting window, UID and join URL', () => {
    const ics = buildIcs(event, stamp);
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('UID:abc-123@pairux.com');
    expect(lines).toContain('DTSTAMP:20260922T080000Z');
    expect(lines).toContain('DTSTART:20260922T090000Z');
    expect(lines).toContain('DTEND:20260922T100000Z');
    expect(lines).toContain('URL:https://pairux.com/join/U1U2JJ');
    expect(lines).toContain('SUMMARY:Pairux 3+ particpant test mac/win');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('RRULE');
  });

  it('escapes commas, semicolons and newlines in text fields', () => {
    const ics = buildIcs(
      { ...event, title: 'Sprint; review, part 2', description: 'line one\nline two' },
      stamp
    );
    expect(ics).toContain('SUMMARY:Sprint\\; review\\, part 2');
    expect(ics).toContain(
      'DESCRIPTION:line one\\nline two\\n\\nJoin at: https://pairux.com/join/U1U2JJ'
    );
  });

  it('folds lines longer than 75 octets with a leading space', () => {
    const ics = buildIcs({ ...event, description: 'x'.repeat(200) }, stamp);
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`DESCRIPTION:${'x'.repeat(200)}`);
  });

  it('carries a recurrence as an RRULE so the event lands as a series', () => {
    const ics = buildIcs(
      { ...event, recurrence: { freq: 'weekly', interval: 2, count: 5 } },
      stamp
    );
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5');
  });

  it('derives a UID from the join URL when none is given', () => {
    const { uid: _uid, ...bare } = event;
    expect(buildIcs(bare, stamp)).toContain('UID:https---pairux-com-join-U1U2JJ@pairux.com');
  });
});

describe('calendar links', () => {
  it('Google link carries the UTC window and join URL', () => {
    const url = new URL(buildGoogleCalendarUrl(event));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('dates')).toBe('20260922T090000Z/20260922T100000Z');
    expect(url.searchParams.get('location')).toBe(event.joinUrl);
  });

  it('Outlook link carries ISO start and end', () => {
    const url = new URL(buildOutlookUrl(event));
    expect(url.hostname).toBe('outlook.live.com');
    expect(url.searchParams.get('startdt')).toBe('2026-09-22T09:00:00.000Z');
    expect(url.searchParams.get('enddt')).toBe('2026-09-22T10:00:00.000Z');
  });

  it('filename keeps only safe characters', () => {
    expect(icsFilename(event.title)).toBe('Pairux-3--particpant-test-mac-win.ics');
  });
});
