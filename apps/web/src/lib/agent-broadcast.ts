/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * Agent broadcasts: an account agent (Bearer pux_ag_ key) puts audio live on
 * one of its owner's channels without a browser, e.g. a podcast episode the
 * moment it is recorded.
 *
 * Start opens a public SFU room on the channel with the agent's OWNER as its
 * host (so the existing listings, go-live notifications and restreams treat it
 * like any live) and hands back a LiveKit token whose identity IS that host
 * id: when the publisher disconnects, the webhook's "host left" path ends the
 * live exactly as it does for a person. The publisher pings the heartbeat
 * route while it plays (the listings drop a host unseen for 90 s) and ends the
 * room with DELETE when it is done.
 *
 * The rows are written with the service client, so every rule a person's
 * client would hit is checked here: the channel must be one the owner may go
 * live on (can_use_resource), and only the agent that started a broadcast may
 * ping or end it.
 */
import { z } from 'zod';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import type { VideoGrant } from 'livekit-server-sdk';
import { maxListeners, participantCap } from '@pairux/shared-types';
import { resolveUserPlan, type Db } from '@/lib/orgs';
import { liveUrl, SITE_URL } from '@/lib/embed';

export const startBroadcastSchema = z.object({
  channel: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, '').toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'channel: a channel handle')),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
});

export type StartBroadcast = z.infer<typeof startBroadcastSchema>;

export class BroadcastError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface BroadcastAgent {
  id: string;
  name: string;
  ownerUserId: string;
}

export interface Broadcast {
  sessionId: string;
  joinCode: string;
  roomName: string;
  /** LiveKit server URL (wss://). */
  url: string;
  /** Publish-only token for the room; identity = the channel owner (the host). */
  token: string;
  liveUrl: string;
  channelUrl: string;
}

export const roomNameOf = (sessionId: string): string => `session-${sessionId}`;

/**
 * The host's grant: microphone (and camera, for a cover picture) into this one
 * room, nothing to subscribe to, no data channel.
 */
export function publisherGrant(sessionId: string): VideoGrant {
  return {
    room: roomNameOf(sessionId),
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
    canSubscribe: false,
    canPublishData: false,
  };
}

export async function publisherToken(input: {
  apiKey: string;
  apiSecret: string;
  sessionId: string;
  hostId: string;
  name: string;
  agentId: string;
}): Promise<string> {
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.hostId,
    name: input.name,
    ttl: '24h',
    // role host: viewers read this to tell the host from the audience.
    metadata: JSON.stringify({ role: 'host', userId: input.hostId, broadcastBy: input.agentId }),
  });
  token.addGrant(publisherGrant(input.sessionId));
  return token.toJwt();
}

interface ChannelRow {
  id: string;
  handle: string;
  name: string;
  owner_id: string;
  org_id: string | null;
  team_id: string | null;
}

async function channelFor(db: Db, agent: BroadcastAgent, handle: string): Promise<ChannelRow> {
  const { data } = await (db as any)
    .from('channels')
    .select('id, handle, name, owner_id, org_id, team_id')
    .ilike('handle', handle)
    .maybeSingle();
  const channel = data as ChannelRow | null;
  if (!channel) throw new BroadcastError(`No channel @${handle}`, 404);
  const { data: allowed } = await (db.rpc as any)('can_use_resource', {
    p_owner: channel.owner_id,
    p_org: channel.org_id,
    p_team: channel.team_id,
    p_user: agent.ownerUserId,
  });
  if (allowed !== true) {
    throw new BroadcastError(`This agent's owner may not go live on @${channel.handle}`, 403);
  }
  return channel;
}

/** Opens the live room and returns where to publish into it. */
export async function startBroadcast(
  db: Db,
  agent: BroadcastAgent,
  input: StartBroadcast,
  livekit: { apiKey: string; apiSecret: string; url: string }
): Promise<{ broadcast: Broadcast; channel: ChannelRow; subject: string }> {
  const channel = await channelFor(db, agent, input.channel);
  const plan = await resolveUserPlan(db, agent.ownerUserId);
  const now = new Date().toISOString();
  const { data, error } = await (db as any)
    .from('sessions')
    .insert({
      host_user_id: agent.ownerUserId,
      creator_id: agent.ownerUserId,
      current_host_id: agent.ownerUserId,
      // The insert trigger fills an empty join code with a unique one.
      join_code: '',
      mode: 'sfu',
      status: 'active',
      settings: {
        quality: 'medium',
        allowControl: false,
        maxParticipants: participantCap(plan),
        maxListeners: maxListeners(plan),
        broadcast: { agentId: agent.id },
      },
      channel_id: channel.id,
      org_id: channel.org_id,
      team_id: channel.team_id,
      is_public: true,
      subject: input.title,
      description: input.description ?? null,
      published_at: now,
      host_last_seen_at: now,
      live_notified_at: now,
    })
    .select('id, join_code')
    .single();
  if (error || !data) {
    throw new BroadcastError(`Could not open the room: ${String(error?.message ?? 'no row')}`, 500);
  }
  const sessionId = String(data.id);
  const joinCode = String(data.join_code);
  const token = await publisherToken({
    apiKey: livekit.apiKey,
    apiSecret: livekit.apiSecret,
    sessionId,
    hostId: agent.ownerUserId,
    name: channel.name,
    agentId: agent.id,
  });
  return {
    broadcast: {
      sessionId,
      joinCode,
      roomName: roomNameOf(sessionId),
      url: livekit.url,
      token,
      liveUrl: liveUrl(joinCode),
      channelUrl: `${SITE_URL}/@${channel.handle}`,
    },
    channel,
    subject: input.title,
  };
}

/** A broadcast this agent started and has not ended, or a 404. */
async function ownBroadcast(
  db: Db,
  agent: BroadcastAgent,
  sessionId: string
): Promise<{ id: string; status: string }> {
  const { data } = await (db as any)
    .from('sessions')
    .select('id, status, settings')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data || data.settings?.broadcast?.agentId !== agent.id) {
    throw new BroadcastError('No broadcast of yours by that id', 404);
  }
  return { id: String(data.id), status: String(data.status) };
}

/** Keeps the live listed: the listings drop a host unseen for 90 seconds. */
export async function heartbeatBroadcast(
  db: Db,
  agent: BroadcastAgent,
  sessionId: string
): Promise<{ live: boolean }> {
  const row = await ownBroadcast(db, agent, sessionId);
  if (row.status === 'ended') return { live: false };
  const { data } = await (db as any)
    .from('sessions')
    .update({ host_last_seen_at: new Date().toISOString() })
    .eq('id', sessionId)
    .not('current_host_id', 'is', null)
    .select('id');
  return { live: Array.isArray(data) && data.length > 0 };
}

/** Ends the live: no host, status ended. Restreams are stopped by the caller. */
export async function endBroadcast(
  db: Db,
  agent: BroadcastAgent,
  sessionId: string
): Promise<{ ended: true }> {
  await ownBroadcast(db, agent, sessionId);
  await (db as any)
    .from('sessions')
    .update({ status: 'ended', current_host_id: null, restream_egress_id: null })
    .eq('id', sessionId);
  return { ended: true };
}
