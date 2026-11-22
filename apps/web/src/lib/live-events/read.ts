/**
 * Server-side reads of public events through the anon-callable RPCs. Every
 * failure reads as "nothing" so a public page never 500s on a feed hiccup.
 */
import { createClient } from '@/lib/supabase/server';
import type { PublicEventRow } from './public';

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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
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
