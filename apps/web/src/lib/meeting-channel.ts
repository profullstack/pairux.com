/**
 * The channel a scheduled meeting broadcasts on.
 *
 * Meetings are written with the service client, which bypasses the channel
 * rules, so the API has to ask on the host's behalf whether they may use the
 * channel they picked. `list_my_channels` is that answer: it returns exactly
 * the channels `can_use_resource` lets the caller go live on (their own, plus
 * team and org channels), which is also the list the meeting form offers.
 */
import type { createClient } from '@/lib/supabase/server';

type UserClient = Awaited<ReturnType<typeof createClient>>;

export async function canBroadcastOnChannel(
  userClient: UserClient,
  channelId: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  const { data, error } = await (userClient.rpc as any)('list_my_channels');
  if (error || !Array.isArray(data)) return false;
  return (data as { id: string }[]).some((c) => c.id === channelId);
}
