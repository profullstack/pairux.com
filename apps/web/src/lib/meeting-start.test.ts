import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendMeetingStartNotices,
  startNoticeEmailHtml,
  startNoticeRecipients,
} from './meeting-start';

const mockSend = vi.fn();
vi.mock('@profullstack/emailer', () => ({
  createEmailer: () => ({ send: (...args: unknown[]) => mockSend(...args) }),
}));

const meeting = {
  id: 'meeting-1',
  title: 'Weekly Sync',
  scheduled_at: '2026-09-01T15:00:00+00:00',
  join_code: 'ABC123',
};

function invitee(id: string, rsvp = 'pending') {
  return { id, email: `${id}@example.com`, name: null, rsvp_status: rsvp };
}

/** Claims succeed unless the slot key is in `taken`. */
function db(taken = new Set<string>()) {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    client: {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          const key = `${String(row.recipient_key)}:${String(row.lead_minutes)}`;
          if (taken.has(key)) return Promise.resolve({ error: { code: '23505' } });
          taken.add(key);
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
}

describe('startNoticeRecipients', () => {
  it('leaves out anyone who declined', () => {
    const list = [invitee('a'), invitee('b', 'declined'), invitee('c', 'accepted')];
    expect(startNoticeRecipients(list).map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('startNoticeEmailHtml', () => {
  it('carries the join link and the code', () => {
    const html = startNoticeEmailHtml({
      title: 'Weekly Sync',
      hostName: 'Ada',
      joinUrl: 'https://pairux.com/join/ABC123',
      joinCode: 'ABC123',
      recipientName: 'Grace',
    });

    expect(html).toContain('https://pairux.com/join/ABC123');
    expect(html).toContain('ABC123');
    expect(html).toContain('Hi Grace,');
    expect(html).toContain('Ada');
  });
});

describe('sendMeetingStartNotices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
    process.env.RESEND_API_KEY = 'test-key';
  });

  it('mails everyone still on the list once', async () => {
    const store = db();
    const result = await sendMeetingStartNotices({
      db: store.client,
      meeting,
      invitees: [invitee('a'), invitee('b', 'accepted'), invitee('c', 'declined')],
      hostName: 'Ada',
      appUrl: 'https://pairux.com',
    });

    expect(result.notified).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(store.inserted).toHaveLength(2);
    // Lead 0 is what marks this as the "it has started" notice.
    expect(store.inserted.every((row) => row.lead_minutes === 0)).toBe(true);
    // Keyed on the occurrence, so a recurring series gets fresh slots each week.
    expect(store.inserted[0]?.occurrence_at).toBe(meeting.scheduled_at);
  });

  it('sends nothing the second time a host starts the same occurrence', async () => {
    const taken = new Set<string>();
    const first = db(taken);
    await sendMeetingStartNotices({
      db: first.client,
      meeting,
      invitees: [invitee('a')],
      hostName: 'Ada',
      appUrl: 'https://pairux.com',
    });

    const second = db(taken);
    const result = await sendMeetingStartNotices({
      db: second.client,
      meeting,
      invitees: [invitee('a')],
      hostName: 'Ada',
      appUrl: 'https://pairux.com',
    });

    expect(result.notified).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one address fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('bounced'));
    const result = await sendMeetingStartNotices({
      db: db().client,
      meeting,
      invitees: [invitee('a'), invitee('b')],
      hostName: 'Ada',
      appUrl: 'https://pairux.com',
    });

    expect(result.notified).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('does nothing when there is nobody to tell', async () => {
    const result = await sendMeetingStartNotices({
      db: db().client,
      meeting,
      invitees: [],
      hostName: 'Ada',
      appUrl: 'https://pairux.com',
    });

    expect(result.notified).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
