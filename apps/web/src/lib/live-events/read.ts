/**
 * Server-side reads of public events through the anon-callable RPCs. Every
 * failure reads as "nothing" so a public page never 500s on a feed hiccup.
 */
import { createClient } from '@/lib/supabase/server';
import type { ChannelRecording } from '@pairux/shared-types';
import type { PublicEventRow } from './public';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await (supabase.rpc as any)(name, args);
    if (error) return null;
    return data as T;
  } catch {
    return null;
  }
}

export async function channelEvents(handle: string): Promise<PublicEventRow[]> {
  return (
    (await rpc<PublicEventRow[]>('list_channel_events', { p_handle: handle, p_limit: 100 })) ?? []
  );
}

export async function publicEvent(id: string): Promise<PublicEventRow | null> {
  if (!UUID.test(id)) return null;
  return (await rpc<PublicEventRow[]>('get_public_event', { p_id: id }))?.[0] ?? null;
}

export async function upcomingPublicEvents(limit = 24): Promise<PublicEventRow[]> {
  return (await rpc<PublicEventRow[]>('list_upcoming_public_events', { p_limit: limit })) ?? [];
}

export interface PublicChannel {
  id: string;
  handle: string;
  name: string;
  description: string | null;
}

export async function publicChannel(handle: string): Promise<PublicChannel | null> {
  return (await rpc<PublicChannel[]>('get_channel', { p_handle: handle }))?.[0] ?? null;
}

/** A private meeting on the channel, for its managers: the public fields plus what they need to start it. */
export interface PrivateEventRow extends PublicEventRow {
  join_code: string;
  replay_visibility: 'off' | 'private' | 'public';
}

/** The channel's private schedule. Empty for anyone who does not manage the channel. */
export async function privateChannelEvents(handle: string): Promise<PrivateEventRow[]> {
  return (
    (await rpc<PrivateEventRow[]>('list_channel_private_events', {
      p_handle: handle,
      p_limit: 100,
    })) ?? []
  );
}

/** The channel's private replays. Empty for anyone who does not manage the channel. */
export async function privateChannelRecordings(handle: string): Promise<ChannelRecording[]> {
  return (
    (await rpc<ChannelRecording[]>('list_channel_private_recordings', {
      p_handle: handle,
      p_limit: 60,
    })) ?? []
  );
}

export interface ChannelReplay {
  id: string;
  subject: string | null;
  description: string | null;
  banner_url: string | null;
  playback_url: string;
  duration_seconds: number | null;
  created_at: string;
  is_public: boolean;
  channel_handle: string;
  channel_name: string;
  channel_avatar_url: string | null;
}

/** One replay: public ones for anybody, private ones for the channel's managers; else null. */
export async function channelReplay(handle: string, id: string): Promise<ChannelReplay | null> {
  if (!UUID.test(id)) return null;
  return (
    (await rpc<ChannelReplay[]>('get_channel_replay', { p_handle: handle, p_id: id }))?.[0] ?? null
  );
}
