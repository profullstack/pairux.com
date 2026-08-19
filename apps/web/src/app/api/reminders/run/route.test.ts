import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The only thing standing between this endpoint and anybody who finds the URL
 * is a shared secret, and the endpoint mails a meeting's entire invitee list.
 * So these cover the refusals rather than the happy path.
 */

const runMeetingReminders = vi.fn();
vi.mock('@/lib/meeting-reminders-runner', () => ({
  runMeetingReminders: (...args: unknown[]) => runMeetingReminders(...args),
}));

const SECRET = 'a-long-enough-secret-value';

async function post(headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('./route');
  return POST(new Request('https://pairux.com/api/reminders/run', { method: 'POST', headers }));
}

describe('POST /api/reminders/run', () => {
  beforeEach(() => {
    vi.resetModules();
    runMeetingReminders.mockReset();
    runMeetingReminders.mockResolvedValue({
      meetings: 2,
      emails: 3,
      pushes: 1,
      skipped: 0,
      errors: [],
    });
    process.env.REMINDERS_CRON_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.REMINDERS_CRON_SECRET;
  });

  it('runs and reports what it sent when the secret matches', async () => {
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, meetings: 2, emails: 3, pushes: 1 });
    expect(runMeetingReminders).toHaveBeenCalledOnce();
  });

  it('refuses a wrong secret, and sends nothing', async () => {
    const res = await post({ authorization: 'Bearer not-the-secret-value' });
    expect(res.status).toBe(401);
    expect(runMeetingReminders).not.toHaveBeenCalled();
  });

  it('refuses a missing header', async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(runMeetingReminders).not.toHaveBeenCalled();
  });

  it('refuses a bare token without the Bearer scheme', async () => {
    const res = await post({ authorization: SECRET });
    expect(res.status).toBe(401);
    expect(runMeetingReminders).not.toHaveBeenCalled();
  });

  it('refuses everything when the secret is not configured at all', async () => {
    // The case worth being deliberate about: a new environment where the
    // variable was forgotten must be closed, not open. An endpoint that mails
    // an invitee list is not one to leave ungated by omission.
    delete process.env.REMINDERS_CRON_SECRET;
    const res = await post({ authorization: 'Bearer anything' });
    expect(res.status).toBe(401);
    expect(runMeetingReminders).not.toHaveBeenCalled();
  });

  it('a secret of a different length is refused rather than throwing', async () => {
    // timingSafeEqual throws on unequal lengths, which would turn a wrong guess
    // into a 500 and leak the secret's length through the error.
    const res = await post({ authorization: 'Bearer short' });
    expect(res.status).toBe(401);
  });

  it('reports a failed run as 500 rather than pretending it worked', async () => {
    runMeetingReminders.mockRejectedValue(new Error('database is on fire'));
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});
