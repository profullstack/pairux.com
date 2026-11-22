import { describe, it, expect } from 'vitest';

import {
  buildGoogleCalendarUrl,
  buildIcs,
  buildIcsFeed,
  buildOutlookUrl,
  calendarLinksHtml,
  icsFilename,
} from './calendar';

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

describe('calendarLinksHtml', () => {
  const urls = { googleCalendarUrl: 'https://g.example/x', outlookUrl: 'https://o.example/y' };

  it('links both providers and mentions the attachment when one is carried', () => {
    const html = calendarLinksHtml({ ...urls, attached: true });
    expect(html).toContain('href="https://g.example/x"');
    expect(html).toContain('href="https://o.example/y"');
    expect(html).toContain('attached <strong>.ics</strong>');
  });

  it('omits the attachment note for a bulk send that cannot carry one', () => {
    const html = calendarLinksHtml({ ...urls, attached: false });
    expect(html).toContain('Add to calendar');
    expect(html).not.toContain('.ics');
  });
});

describe('buildIcsFeed', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const weekly = {
    title: 'Weekly outreach, live',
    description: 'Office hours; bring questions',
    startIso: '2026-11-25T17:00:00Z',
    durationMinutes: 60,
    joinUrl: 'https://pairux.com/e/aaaa',
    uid: 'aaaa@pairux.com',
    recurrence: { freq: 'weekly' as const, interval: 1, count: 0 },
  };
  const once = {
    ...weekly,
    title: 'Launch AMA',
    startIso: '2026-12-01T18:00:00Z',
    uid: 'bbbb@pairux.com',
    recurrence: undefined,
  };

  it('wraps every event in one calendar with a name and an hourly refresh hint', () => {
    const ics = buildIcsFeed(
      { name: "Chovy's channel", description: 'Live on PairUX', url: 'https://pairux.com/c/chovy' },
      [weekly, once],
      now
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("X-WR-CALNAME:Chovy's channel");
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(ics).toContain('UID:aaaa@pairux.com');
    expect(ics).toContain('UID:bbbb@pairux.com');
  });

  it('keeps a repeating event as one series and a one-off as a single date', () => {
    const ics = buildIcsFeed({ name: 'x' }, [weekly, once], now);
    const blocks = ics.split('BEGIN:VEVENT').slice(1);
    expect(blocks[0]).toContain('RRULE:FREQ=WEEKLY');
    expect(blocks[1]).not.toContain('RRULE');
    expect(blocks[1]).toContain('DTSTART:20261201T180000Z');
  });

  it('is a valid empty calendar with no events', () => {
    const ics = buildIcsFeed({ name: 'x' }, [], now);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('X-WR-CALNAME:x');
  });

  it('escapes hostile names and titles so they cannot inject properties', () => {
    const ics = buildIcsFeed(
      { name: 'a\nEND:VCALENDAR' },
      [{ ...once, title: 'x\r\nBEGIN:VALARM;y,z' }],
      now
    );
    // The text may survive escaped inside a value; it must never start a line.
    expect(ics.match(/^END:VCALENDAR/gm)).toHaveLength(1);
    expect(ics.match(/^BEGIN:VALARM/gm)).toBeNull();
    expect(ics).toContain('SUMMARY:x\\nBEGIN:VALARM\\;y\\,z');
  });
});
