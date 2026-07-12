/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { serviceClient } from '@/lib/supabase/service';
import { sendPushToUser } from '@/lib/push';

/** Row returned by the mark_room_went_live RPC when a room just went live. */
export interface GoLiveFlip {
  creator_id: string;
  subject: string | null;
  join_code: string;
}

/**
 * Notify a creator's followers that they've gone live. Call this ONLY after
 * mark_room_went_live has reported a fresh flip (it dedupes), so this fans out
 * exactly once per live session. Fire-and-forget from API routes.
 */
export async function notifyFollowersLive(
  creatorId: string,
  subject: string | null,
  joinCode: string
): Promise<void> {
  try {
    const svc = serviceClient() as any;

    const { data: creator } = await svc
      .from('profiles')
      .select('display_name, username')
      .eq('id', creatorId)
      .single();
    const name: string =
      creator?.display_name ?? (creator?.username ? `@${String(creator.username)}` : 'A creator');

    const { data: followers } = await svc
      .from('follows')
      .select('follower_id')
      .eq('creator_id', creatorId);
    if (!followers || followers.length === 0) return;

    const payload = {
      title: `${name} is live 🔴`,
      body: subject ?? 'Join the room now',
      url: `/join/${joinCode}`,
      tag: `live-${creatorId}`,
    };

    await Promise.allSettled(
      (followers as { follower_id: string }[]).map((f) =>
        sendPushToUser(f.follower_id, 'creatorLive', payload)
      )
    );
  } catch (err) {
    console.error('[notify-live] failed:', err);
  }
}
