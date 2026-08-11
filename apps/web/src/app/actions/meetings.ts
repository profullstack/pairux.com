/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
'use server';

import { createEmailer } from '@profullstack/emailer';

interface InvitePayload {
  scheduledSessionId: string;
  title: string;
  description?: string | undefined;
  scheduledAt: string;
  durationMinutes: number;
  joinCode: string;
  hostName: string;
  invitees: { email: string; name: string | null; token: string }[];
}

interface CancellationPayload {
  title: string;
  scheduledAt: string;
  inviteeEmails: string[];
}

interface RemovalPayload {
  title: string;
  scheduledAt: string;
  inviteeEmail: string;
  inviteeName: string | null;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function inviteEmailHtml(opts: {
  title: string;
  description?: string;
  scheduledAt: string;
  durationMinutes: number;
  joinCode: string;
  hostName: string;
  inviteeName: string | null;
  rsvpAcceptUrl: string;
  rsvpDeclineUrl: string;
  joinUrl: string;
}): string {
  const formattedDate = formatDateTime(opts.scheduledAt);
  const greeting = opts.inviteeName ? `Hi ${opts.inviteeName},` : 'Hi there,';
  const durationLabel =
    opts.durationMinutes >= 60
      ? `${String(opts.durationMinutes / 60)} hour${opts.durationMinutes > 60 ? 's' : ''}`
      : `${String(opts.durationMinutes)} minutes`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Invitation: ${opts.title}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:-.5px;">PairUX</h1>
      <p style="color:rgba(255,255,255,.75);margin:6px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Meeting Invitation</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;margin:0 0 4px;">${greeting}</p>
      <p style="color:#374151;margin:0 0 24px;"><strong>${opts.hostName}</strong> has invited you to a PairUX voice & screen-sharing meeting.</p>

      <h2 style="margin:0 0 20px;font-size:20px;color:#111827;font-weight:700;">${opts.title}</h2>

      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;width:110px;">Date &amp; Time</td>
            <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;">Duration</td>
            <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${durationLabel}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;">Host</td>
            <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${opts.hostName}</td>
          </tr>
          ${
            opts.description
              ? `<tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;vertical-align:top;">Notes</td>
            <td style="padding:6px 0;color:#374151;font-size:14px;">${opts.description}</td>
          </tr>`
              : ''
          }
        </table>
      </div>

      <div style="text-align:center;margin-bottom:28px;">
        <p style="color:#6b7280;font-size:13px;margin:0 0 10px;">Your join code</p>
        <div style="display:inline-block;background:#ede9fe;border-radius:10px;padding:14px 28px;">
          <span style="font-family:monospace;font-size:34px;font-weight:800;color:#4f46e5;letter-spacing:8px;">${opts.joinCode}</span>
        </div>
        <p style="color:#9ca3af;font-size:12px;margin:10px 0 0;">Keep this code — you'll need it to join</p>
      </div>

      <div style="text-align:center;margin-bottom:24px;">
        <a href="${opts.joinUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;">Join Meeting</a>
      </div>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center;margin-bottom:8px;">
        <p style="margin:0 0 10px;color:#166534;font-size:14px;font-weight:500;">Will you attend?</p>
        <a href="${opts.rsvpAcceptUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:9px 22px;border-radius:6px;font-size:13px;font-weight:600;margin:0 6px;">✓ Yes, I'll be there</a>
        <a href="${opts.rsvpDeclineUrl}" style="display:inline-block;background:#fff;color:#6b7280;text-decoration:none;padding:9px 22px;border-radius:6px;font-size:13px;font-weight:500;border:1px solid #d1d5db;margin:0 6px;">✗ Can't make it</a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:18px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via <a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a> · Real-time voice &amp; screen collaboration</p>
    </div>
  </div>
</body>
</html>`;
}

function cancellationEmailHtml(opts: { title: string; scheduledAt: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Meeting Cancelled</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#ef4444;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Meeting Cancelled</h1>
    </div>
    <div style="padding:32px;text-align:center;">
      <p style="color:#374151;font-size:16px;margin:0 0 8px;">The following meeting has been cancelled:</p>
      <h2 style="color:#111827;margin:0 0 8px;">${opts.title}</h2>
      <p style="color:#6b7280;font-size:14px;">Originally scheduled for: ${formatDateTime(opts.scheduledAt)}</p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;"><a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a></p>
    </div>
  </div>
</body>
</html>`;
}

function removalEmailHtml(opts: {
  title: string;
  scheduledAt: string;
  inviteeName: string | null;
}): string {
  const greeting = opts.inviteeName ? `Hi ${opts.inviteeName},` : 'Hi there,';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Invitation Withdrawn</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#6b7280;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Invitation Withdrawn</h1>
    </div>
    <div style="padding:32px;text-align:center;">
      <p style="color:#374151;font-size:15px;margin:0 0 16px;">${greeting}</p>
      <p style="color:#374151;font-size:15px;margin:0 0 8px;">You have been removed from this meeting:</p>
      <h2 style="color:#111827;margin:0 0 8px;">${opts.title}</h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">Scheduled for: ${formatDateTime(opts.scheduledAt)}</p>
      <p style="color:#9ca3af;font-size:13px;margin:16px 0 0;">Please disregard the join code from your earlier invitation.</p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;"><a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a></p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendMeetingInvites(
  payload: InvitePayload
): Promise<{ ok: boolean; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com';
  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';
  const emailer = createEmailer({ resendApiKey, defaultFrom });

  const errors: string[] = [];

  for (const invitee of payload.invitees) {
    const rsvpBase = `${appUrl}/invite/${invitee.token}`;
    const html = inviteEmailHtml({
      title: payload.title,
      ...(payload.description !== undefined && { description: payload.description }),
      scheduledAt: payload.scheduledAt,
      durationMinutes: payload.durationMinutes,
      joinCode: payload.joinCode,
      hostName: payload.hostName,
      inviteeName: invitee.name,
      joinUrl: `${appUrl}/join/${payload.joinCode}`,
      rsvpAcceptUrl: `${rsvpBase}?rsvp=accepted`,
      rsvpDeclineUrl: `${rsvpBase}?rsvp=declined`,
    });

    try {
      await (emailer as any).send({
        to: invitee.email,
        subject: `Meeting Invitation: ${payload.title}`,
        html,
      });
    } catch (err) {
      errors.push(`${invitee.email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.error('Some invite emails failed:', errors);
  }

  return { ok: true };
}

export async function sendInviteeRemoval(
  payload: RemovalPayload
): Promise<{ ok: boolean; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';
  const emailer = createEmailer({ resendApiKey, defaultFrom });
  const html = removalEmailHtml({
    title: payload.title,
    scheduledAt: payload.scheduledAt,
    inviteeName: payload.inviteeName,
  });

  try {
    await (emailer as any).send({
      to: payload.inviteeEmail,
      subject: `Invitation withdrawn: ${payload.title}`,
      html,
    });
  } catch (err) {
    console.error('Removal email failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true };
}

export async function sendMeetingCancellation(
  payload: CancellationPayload
): Promise<{ ok: boolean; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';
  const emailer = createEmailer({ resendApiKey, defaultFrom });
  const html = cancellationEmailHtml({ title: payload.title, scheduledAt: payload.scheduledAt });

  try {
    await (emailer as any).sendBulk({
      to: payload.inviteeEmails,
      subject: `Cancelled: ${payload.title}`,
      html,
    });
  } catch (err) {
    console.error('Cancellation email failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true };
}
