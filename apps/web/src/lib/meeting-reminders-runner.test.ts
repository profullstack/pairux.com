import { describe, it, expect, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@profullstack/emailer', () => ({ createEmailer: vi.fn() }));
vi.mock('./push', () => ({ sendPushToUser: vi.fn() }));

import { reminderEmailHtml } from './meeting-reminders-runner';

describe('reminderEmailHtml', () => {
  const html = reminderEmailHtml({
    title: 'Pairux 3+ particpant test mac/win',
    when: 'in about an hour',
    startsAtLabel: 'Tue, 22 Sep 2026 09:00:00 GMT',
    joinUrl: 'https://pairux.com/join/U1U2JJ',
    joinCode: 'U1U2JJ',
    recipientName: 'Anthony Ettinger',
    googleCalendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=x',
    outlookUrl: 'https://outlook.live.com/calendar/0/deeplink/compose?subject=x',
  });

  it('links to Google and Outlook and points at the attached .ics', () => {
    expect(html).toContain(
      'href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=x"'
    );
    expect(html).toContain('href="https://outlook.live.com/calendar/0/deeplink/compose?subject=x"');
    expect(html).toContain('Add to calendar');
    expect(html).toContain('.ics');
  });

  it('still carries the join button and code', () => {
    expect(html).toContain('href="https://pairux.com/join/U1U2JJ"');
    expect(html).toContain('Join code: <strong>U1U2JJ</strong>');
    expect(html).toContain('Hi Anthony Ettinger,');
  });
});
