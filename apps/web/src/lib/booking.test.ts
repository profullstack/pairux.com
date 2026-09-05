import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/meetings', () => ({ sendMeetingInvites: vi.fn() }));
vi.mock('@profullstack/emailer', () => ({ createEmailer: vi.fn() }));

import {
  hostBookingEmailHtml,
  publicHost,
  publicPage,
  slotOptionsFor,
  type BookingPageRow,
} from './booking';

const page: BookingPageRow = {
  id: 'p1',
  host_user_id: 'h1',
  slug: 'intro',
  title: 'Intro call',
  description: null,
  duration_minutes: 30,
  timezone: 'America/Los_Angeles',
  availability: { mon: [{ start: '09:00', end: '17:00' }] },
  buffer_minutes: 10,
  min_notice_minutes: 120,
  max_days_ahead: 14,
  active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

describe('public shapes', () => {
  it('shows a guest only what they need, and falls back to the username as the name', () => {
    expect(
      publicHost({ id: 'h1', username: 'chovy', display_name: null, avatar_url: null, bio: 'hi' })
    ).toEqual({
      username: 'chovy',
      displayName: 'chovy',
      avatarUrl: null,
      bio: 'hi',
    });
    expect(publicPage(page)).toEqual({
      slug: 'intro',
      title: 'Intro call',
      description: null,
      durationMinutes: 30,
      timezone: 'America/Los_Angeles',
      maxDaysAhead: 14,
    });
    expect(publicPage(page)).not.toHaveProperty('host_user_id');
  });
});

describe('slotOptionsFor', () => {
  it('carries every rule of the page into the calculator', () => {
    const busy = [{ start: '2026-09-07T16:00:00.000Z', end: '2026-09-07T16:30:00.000Z' }];
    const now = new Date('2026-09-07T12:00:00.000Z');
    expect(slotOptionsFor(page, busy, { fromDate: '2026-09-07', days: 7, now })).toEqual({
      availability: page.availability,
      timezone: 'America/Los_Angeles',
      durationMinutes: 30,
      bufferMinutes: 10,
      minNoticeMinutes: 120,
      maxDaysAhead: 14,
      busy,
      fromDate: '2026-09-07',
      days: 7,
      now,
    });
  });
});

describe('hostBookingEmailHtml', () => {
  const base = {
    hostName: 'Anthony',
    title: 'Intro call with Judith',
    guestName: 'Judith',
    guestEmail: 'judith@example.com',
    notes: undefined,
    when: 'Monday, September 7, 9:00 AM PDT',
    durationMinutes: 30,
    joinCode: 'ABC123',
    dashboardUrl: 'https://pairux.com/dashboard',
  };

  it('names the guest, the time and the join code, and links the dashboard', () => {
    const html = hostBookingEmailHtml(base);
    expect(html).toContain('Judith &lt;judith@example.com&gt;');
    expect(html).toContain('Monday, September 7, 9:00 AM PDT');
    expect(html).toContain('ABC123');
    expect(html).toContain('https://pairux.com/dashboard');
    expect(html).not.toContain('Notes');
  });

  // A guest's notes are the one free-text field in this email, and they land
  // in the host's inbox as HTML.
  it('escapes the guest notes rather than rendering them', () => {
    const html = hostBookingEmailHtml({ ...base, notes: '<script>alert(1)</script> & co' });
    expect(html).toContain('Notes');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('<script>');
  });
});
