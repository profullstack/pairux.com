/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { serviceClient } from '@/lib/supabase/service';
import { sendPushToUser } from '@/lib/push';
import { createEmailer } from '@profullstack/emailer';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Notify a user that they've received a direct message — web push + email.
 * Fire-and-forget; called after a DM is successfully inserted. Respects the
 * recipient's `directMessage` notification preference (enforced in sendPushToUser).
 */
export async function notifyDirectMessage(params: {
  recipientId: string;
  senderId: string;
  body: string;
}): Promise<void> {
  try {
    const svc = serviceClient() as any;

    // Sender identity for the notification copy + the reply link.
    const { data: sender } = await svc
      .from('profiles')
      .select('display_name, username')
      .eq('id', params.senderId)
      .single();

    const username = sender?.username as string | undefined;
    const name =
      (sender?.display_name as string | undefined) ?? (username ? `@${username}` : 'Someone');

    // Reply link points at the thread when the sender has a username; otherwise
    // fall back to the inbox.
    const path = username ? `/messages/${username}` : '/messages';
    const preview = truncate(params.body);

    const payload = {
      title: `New message from ${name}`,
      body: preview,
      url: path,
      tag: `dm-${params.senderId}`,
    };

    await Promise.allSettled([
      sendPushToUser(params.recipientId, 'directMessage', payload),
      emailDirectMessage(svc, params.recipientId, name, preview, path),
    ]);
  } catch (err) {
    console.error('[notify-dm] failed:', err);
  }
}

async function emailDirectMessage(
  svc: any,
  recipientId: string,
  name: string,
  preview: string,
  path: string
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return; // email disabled if not configured

  const { data } = await svc.auth.admin.getUserById(recipientId);
  const email = data?.user?.email as string | undefined;
  if (!email) return;

  const link = `https://pairux.com${path}`;
  const safeName = escapeHtml(name);
  const safePreview = escapeHtml(preview);
  const html = `<p>${safeName} sent you a message on PairUX:</p><blockquote>${safePreview}</blockquote><p><a href="${link}">Read &amp; reply →</a></p>`;
  const text = `${name} sent you a message on PairUX:\n\n"${preview}"\n\nRead & reply: ${link}`;

  const emailer = createEmailer({
    resendApiKey,
    defaultFrom: process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>',
  });
  await emailer.sendBulk({
    to: [email],
    subject: `${name} messaged you on PairUX`,
    html,
    text,
  });
}
