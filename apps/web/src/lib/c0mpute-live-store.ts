/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
// Supabase store for c0mpute Live (see c0mpute-live.ts).
//
// Two clients on purpose:
//  - `user` is the signed-in user's own client. Channels and restream
//    destinations go through the existing SECURITY DEFINER RPCs, so the
//    database enforces "owner, org admin or team lead" (can_manage_resource)
//    on every write, exactly as the dashboard does.
//  - `admin` is the service role, for the two tables that have no policies:
//    c0mpute_live_links and the one-row c0mpute_oauth_client cache.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  C0MPUTE_PLATFORM,
  type C0mputeLiveStore,
  type ChannelRef,
  type ClientCache,
  type LiveLink,
} from '@/lib/c0mpute-live';

interface DestRow {
  id: string;
  platform: string;
  enabled: boolean;
}

export function supabaseClientCache(admin: SupabaseClient): ClientCache {
  const db = admin as any;
  return {
    async getClient(redirectUri) {
      const { data } = await db
        .from('c0mpute_oauth_client')
        .select('client_id, redirect_uri')
        .eq('id', true)
        .maybeSingle();
      return data?.redirect_uri === redirectUri && typeof data.client_id === 'string'
        ? (data.client_id as string)
        : null;
    },
    async saveClient(redirectUri, clientId) {
      const { error } = await db
        .from('c0mpute_oauth_client')
        .upsert({ id: true, client_id: clientId, redirect_uri: redirectUri }, { onConflict: 'id' });
      if (error) throw new Error('could not cache the c0mpute client registration');
    },
    async clearClient() {
      await db.from('c0mpute_oauth_client').delete().eq('id', true);
    },
  };
}

export function supabaseC0mputeLiveStore(
  user: SupabaseClient,
  admin: SupabaseClient
): C0mputeLiveStore {
  const rpc = (name: string, args?: Record<string, unknown>) => (user.rpc as any)(name, args);
  const db = admin as any;

  const destinations = async (channelId: string): Promise<DestRow[]> => {
    const { data, error } = await rpc('list_channel_restream_destinations', {
      p_channel_id: channelId,
    });
    if (error) throw new Error('not allowed to manage this channel');
    return (data ?? []) as DestRow[];
  };

  return {
    async manageableChannels(): Promise<ChannelRef[]> {
      const { data, error } = await rpc('list_my_channels');
      if (error) throw new Error('could not list channels');
      return ((data ?? []) as any[])
        .filter((c) => c.can_manage === true)
        .map((c) => ({ id: String(c.id), handle: String(c.handle), name: String(c.name) }));
    },

    async upsertDestination(channelId, dest) {
      // Both RPCs raise 'Not your channel' unless the user may manage it.
      const current = (await destinations(channelId)).find((d) => d.platform === C0MPUTE_PLATFORM);
      const { error } = await rpc('upsert_channel_restream_destination', {
        p_channel_id: channelId,
        p_id: current?.id ?? null,
        p_platform: C0MPUTE_PLATFORM,
        p_label: dest.label,
        p_rtmp_url: dest.rtmpUrl,
        p_stream_key: dest.streamKey,
        p_enabled: true,
      });
      // Deliberately not passing the database message on.
      if (error) throw new Error('could not save the restream destination');
    },

    async enableRestreamIfSafe(channelId) {
      const others = (await destinations(channelId)).filter(
        (d) => d.platform !== C0MPUTE_PLATFORM && d.enabled
      );
      // Flipping the master switch would also start those. Leave that to the user.
      if (others.length > 0) return;
      await rpc('set_channel_restream_enabled', { p_channel_id: channelId, p_enabled: true });
    },

    async saveLink(link: LiveLink) {
      const { error } = await db
        .from('c0mpute_live_links')
        .upsert({ ...link, created_at: new Date().toISOString() }, { onConflict: 'channel_id' });
      if (error) throw new Error('could not save the c0mpute link');
    },
  };
}

export interface StoredLink extends LiveLink {
  created_at: string;
}

/**
 * The user's links that still have their c0mpute destination. A link whose
 * destination was removed from the dashboard is stale and is dropped here.
 */
export async function linksForUser(admin: SupabaseClient, userId: string): Promise<StoredLink[]> {
  const db = admin as any;
  const { data: links } = await db
    .from('c0mpute_live_links')
    .select('channel_id, user_id, stream_id, watch_url, playback_url, account_label, created_at')
    .eq('user_id', userId);
  // Oldest first; channel id breaks ties so the order is stable.
  const rows = ((links ?? []) as StoredLink[]).sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.channel_id.localeCompare(b.channel_id)
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.channel_id);
  // Never selects stream_key.
  const { data: dests, error } = await db
    .from('channel_restream_destinations')
    .select('channel_id')
    .eq('platform', C0MPUTE_PLATFORM)
    .in('channel_id', ids);
  if (error) return rows;
  const live = new Set(((dests ?? []) as { channel_id: string }[]).map((d) => d.channel_id));
  const stale = ids.filter((id) => !live.has(id));
  if (stale.length > 0) {
    await db.from('c0mpute_live_links').delete().eq('user_id', userId).in('channel_id', stale);
  }
  return rows.filter((r) => live.has(r.channel_id));
}

/** Remove the user's c0mpute destinations and link rows. Returns how many channels. */
export async function disconnectUser(admin: SupabaseClient, userId: string): Promise<number> {
  const db = admin as any;
  const { data: links } = await db
    .from('c0mpute_live_links')
    .select('channel_id')
    .eq('user_id', userId);
  const ids = ((links ?? []) as { channel_id: string }[]).map((r) => r.channel_id);
  if (ids.length === 0) return 0;
  // Scoped to channels this user linked (a link is only ever written after the
  // database confirmed the user may manage the channel) and to platform c0mpute.
  const { error } = await db
    .from('channel_restream_destinations')
    .delete()
    .eq('platform', C0MPUTE_PLATFORM)
    .in('channel_id', ids);
  if (error) throw new Error('could not remove the c0mpute destinations');
  await db.from('c0mpute_live_links').delete().eq('user_id', userId).in('channel_id', ids);
  return ids.length;
}
