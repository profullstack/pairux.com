/* eslint-disable @typescript-eslint/no-explicit-any */
import { createEmailer } from '@profullstack/emailer';

import { claimReminderSlot, STARTED_LEAD_MINUTES } from './meeting-reminder-claim';

/**
 * Telling the guest list that a scheduled meeting has actually begun.
 *
 * The invite email hands out a time and a join code. Neither says whether the
 * host has turned up, so an invitee's only way to find out was to open the link
 * and look. This is the other half: one message, sent once, at the moment the
 * room exists, carrying a link that goes straight into it.
 */

export interface StartNoticeMeeting {
  id: string;
  title: string;
  /** The occurrence being started, as its exact start instant. */
  scheduled_at: string;
  join_code: string;
}

export interface StartNoticeInvitee {
  id: string;
  email: string;
  name: string | null;
  rsvp_status: string;
}

export interface StartNoticeResult {
  notified: number;
  /** Already told about this occurrence, so nothing was sent. */
  skipped: number;
  errors: string[];
}

/**
 * Who gets told. Somebody who declined said no to the meeting itself, not just
 * to its reminders, so telling them it started is a message they have already
 * opted out of.
 */
export function startNoticeRecipients(invitees: StartNoticeInvitee[]): StartNoticeInvitee[] {
  return invitees.filter((invitee) => invitee.rsvp_status !== 'declined');
}

export function startNoticeEmailHtml(opts: {
  title: string;
  hostName: string;
  joinUrl: string;
  joinCode: string;
  recipientName: string | null;
}): string {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi,';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${opts.title} has started</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#16a34a;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Starting now</h1>
    </div>
    <div style="padding:32px;text-align:center;">
      <p style="color:#374151;font-size:15px;margin:0 0 16px;">${greeting}</p>
      <h2 style="color:#111827;margin:0 0 8px;">${opts.title}</h2>
      <p style="color:#6b7280;font-size:14px;margin:0 0 24px;"><strong>${opts.hostName}</strong> has opened the room and is waiting.</p>
      <a href="${opts.joinUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;">Join now</a>
      <p style="color:#9ca3af;font-size:13px;margin-top:20px;">Join code: <strong>${opts.joinCode}</strong></p>
    </div>
    <div style="background:#f9fafb;padding:18px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via <a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a> · Real-time voice &amp; screen collaboration</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Mail everyone still on the guest list that the meeting is live.
 *
 * Sends at most one notice per invitee per occurrence: the slot in
 * `meeting_reminders` is claimed before the send, so a host who clicks Start,
 * closes the app and clicks Start again does not mail the room twice. A
 * recurring series opens fresh slots each time `scheduled_at` rolls forward,
 * because the claim is keyed on the instant rather than the row.
 *
 * Nothing in here is allowed to fail the start itself. The host is already in
 * the room by the time this runs, and a meeting that happened without its
 * announcement beats a Start button that reports failure over an email.
 */
export async function sendMeetingStartNotices(opts: {
  db: any;
  meeting: StartNoticeMeeting;
  invitees: StartNoticeInvitee[];
  hostName: string;
  appUrl: string;
}): Promise<StartNoticeResult> {
  const result: StartNoticeResult = { notified: 0, skipped: 0, errors: [] };

  const recipients = startNoticeRecipients(opts.invitees);
  if (recipients.length === 0) return result;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    result.errors.push('RESEND_API_KEY not configured');
    return result;
  }

  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';
  const emailer = createEmailer({ resendApiKey, defaultFrom });
  const joinUrl = `${opts.appUrl}/join/${opts.meeting.join_code}`;

  for (const invitee of recipients) {
    try {
      const claimed = await claimReminderSlot(opts.db, {
        scheduled_session_id: opts.meeting.id,
        occurrence_at: opts.meeting.scheduled_at,
        lead_minutes: STARTED_LEAD_MINUTES,
        recipient_kind: 'invitee',
        recipient_key: invitee.id,
        channel: 'email',
      });

      if (!claimed) {
        result.skipped += 1;
        continue;
      }

      await (emailer as { send: (o: unknown) => Promise<unknown> }).send({
        to: invitee.email,
        subject: `${opts.meeting.title} is starting now`,
        html: startNoticeEmailHtml({
          title: opts.meeting.title,
          hostName: opts.hostName,
          joinUrl,
          joinCode: opts.meeting.join_code,
          recipientName: invitee.name,
        }),
      });
      result.notified += 1;
    } catch (err) {
      // One bad address must not cost the rest of the room their notice.
      result.errors.push(`${invitee.email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
