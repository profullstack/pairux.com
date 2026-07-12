/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { serviceClient } from '@/lib/supabase/service';
import { sendPushToUser } from '@/lib/push';
import { createEmailer } from '@profullstack/emailer';

/** Row returned by mark_room_went_live when a room just went live. */
export interface GoLiveFlip {
  creator_id: string;
  subject: string | null;
  join_code: string;
  channel_id: string | null;
  channel_handle: string | null;
  channel_name: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Notify a channel's subscribers (or, for legacy channel-less lives, the
 * creator's followers) that it's live — web push + email. Call ONLY after
 * mark_room_went_live reports a fresh flip (it dedupes). Fire-and-forget.
 */
export async function notifyGoLive(flip: GoLiveFlip): Promise<void> {
  try {
    const svc = serviceClient() as any;

    let recipientIds: string[] = [];
    let name = 'A creator';

    if (flip.channel_id) {
      const { data } = await svc
        .from('channel_subscriptions')
        .select('subscriber_id')
        .eq('channel_id', flip.channel_id);
      recipientIds = (data ?? []).map((r: { subscriber_id: string }) => r.subscriber_id);
      name = flip.channel_name ?? (flip.channel_handle ? `@${flip.channel_handle}` : 'A channel');
    } else {
      const { data } = await svc
        .from('follows')
        .select('follower_id')
        .eq('creator_id', flip.creator_id);
      recipientIds = (data ?? []).map((r: { follower_id: string }) => r.follower_id);
      const { data: creator } = await svc
        .from('profiles')
        .select('display_name, username')
        .eq('id', flip.creator_id)
        .single();
      name =
        creator?.display_name ?? (creator?.username ? `@${String(creator.username)}` : 'A creator');
    }

    if (recipientIds.length === 0) return;

    const path = `/l/${flip.join_code}`;
    const payload = {
      title: `${name} is live 🔴`,
      body: flip.subject ?? 'Join the room now',
      url: path,
      tag: `live-${flip.channel_id ?? flip.creator_id}`,
    };

    await Promise.allSettled([
      ...recipientIds.map((id) => sendPushToUser(id, 'creatorLive', payload)),
      emailGoLive(svc, recipientIds, name, flip.subject, path),
    ]);
  } catch (err) {
    console.error('[notify-live] failed:', err);
  }
}

async function emailGoLive(
  svc: any,
  recipientIds: string[],
  name: string,
  subject: string | null,
  path: string
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return; // email disabled if not configured

  const emails: string[] = [];
  await Promise.allSettled(
    recipientIds.map(async (id) => {
      const { data } = await svc.auth.admin.getUserById(id);
      const email = data?.user?.email as string | undefined;
      if (email) emails.push(email);
    })
  );
  if (emails.length === 0) return;

  const link = `https://pairux.com${path}`;
  const safeName = escapeHtml(name);
  const line = subject ? `${safeName} is live: ${escapeHtml(subject)}` : `${safeName} is live`;
  const html = `<p>${line} on PairUX.</p><p><a href="${link}">Watch now →</a></p>`;
  const text = `${subject ? `${name} is live: ${subject}` : `${name} is live`} on PairUX.\nWatch: ${link}`;

  const emailer = createEmailer({
    resendApiKey,
    defaultFrom: process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>',
  });
  await emailer.sendBulk({ to: emails, subject: `${name} is live on PairUX`, html, text });
}
