/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { EncodingOptions, StreamOutput, StreamProtocol } from 'livekit-server-sdk';
import { serviceClient } from '@/lib/supabase/service';
import { getEgressClient } from '@/lib/livekit-egress';

/**
 * External RTMP restreaming driven by a channel's saved destinations.
 *
 * When a channel with restream_enabled goes public, we build the full ingest
 * URLs (rtmp_url + '/' + stream_key) server-side from channel_restream_
 * destinations (keys never leave the server) and fan them out through a single
 * LiveKit RoomComposite egress. The egress id is stored on the session so it
 * can be stopped when the host leaves.
 */
function joinUrl(rtmpUrl: string, key: string): string {
  return `${rtmpUrl.replace(/\/+$/, '')}/${key}`;
}

/** Start restreaming a session to its channel's enabled destinations. */
export async function startChannelRestream(sessionId: string, channelId: string): Promise<void> {
  try {
    const svc = serviceClient() as any;

    const { data: channel } = await svc
      .from('channels')
      .select('restream_enabled')
      .eq('id', channelId)
      .single();
    if (!channel?.restream_enabled) return;

    const { data: dests } = await svc
      .from('channel_restream_destinations')
      .select('rtmp_url, stream_key, enabled')
      .eq('channel_id', channelId)
      .eq('enabled', true);

    const rtmpUrls: string[] = (dests ?? [])
      .filter((d: any) => typeof d.rtmp_url === 'string' && typeof d.stream_key === 'string')
      .map((d: any) => joinUrl(d.rtmp_url, d.stream_key))
      .filter((u: string) => /^rtmps?:\/\/.+/.test(u))
      .slice(0, 4);
    if (rtmpUrls.length === 0) return;

    const egress = getEgressClient();
    if (!egress) return;

    const roomName = `session-${sessionId}`;

    // Idempotent: stop a restream egress already running for this session.
    const { data: existing } = await svc
      .from('sessions')
      .select('restream_egress_id')
      .eq('id', sessionId)
      .single();
    if (existing?.restream_egress_id) {
      try {
        await egress.stopEgress(existing.restream_egress_id);
      } catch {
        /* already stopped */
      }
    }

    // 1080p30 with a 1s keyframe interval — YouTube stalls on the 4s default.
    const encodingOptions = new EncodingOptions({
      width: 1920,
      height: 1080,
      framerate: 30,
      videoBitrate: 4500,
      audioBitrate: 128,
      keyFrameInterval: 1,
    });

    const info = await egress.startRoomCompositeEgress(
      roomName,
      { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: rtmpUrls }) },
      { layout: 'speaker', encodingOptions }
    );

    await svc.from('sessions').update({ restream_egress_id: info.egressId }).eq('id', sessionId);
  } catch (err) {
    console.error('[channel-restream] start failed:', err);
  }
}

/** Stop a session's restream egress (host left / went private). */
export async function stopChannelRestream(sessionId: string): Promise<void> {
  try {
    const svc = serviceClient() as any;
    const { data: session } = await svc
      .from('sessions')
      .select('restream_egress_id')
      .eq('id', sessionId)
      .single();
    const egressId: string | null = session?.restream_egress_id ?? null;
    if (!egressId) return;

    const egress = getEgressClient();
    if (egress) {
      try {
        await egress.stopEgress(egressId);
      } catch {
        /* already stopping */
      }
    }
    await svc.from('sessions').update({ restream_egress_id: null }).eq('id', sessionId);
  } catch (err) {
    console.error('[channel-restream] stop failed:', err);
  }
}
