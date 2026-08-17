import { createClient } from '@/lib/supabase/server';
import { SITE_URL, clockDuration, escapeXml, liveUrl } from '@/lib/embed';

/**
 * Per-channel RSS feed of finished recordings.
 *
 * This is what makes a PairUX channel subscribable outside pairux.com — the
 * itunes:* tags and the <enclosure> on each item let podcast apps (Apple
 * Podcasts, Overcast, Pocket Casts) and ordinary feed readers treat a channel
 * as a show whose episodes are its past lives.
 */

export const dynamic = 'force-dynamic';

interface ChannelRow {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
}

interface RecordingRow {
  id: string;
  join_code: string;
  subject: string | null;
  banner_url: string | null;
  playback_url: string;
  duration_seconds: number | null;
  created_at: string;
}

async function getChannel(handle: string): Promise<ChannelRow | null> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_channel', { p_handle: handle });
    if (error) return null;
    return (data as ChannelRow[] | null)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getRecordings(handle: string): Promise<RecordingRow[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_channel_recordings', {
      p_handle: handle,
      p_limit: 100,
    });
    if (error) return [];
    return (data as RecordingRow[] | null) ?? [];
  } catch {
    return [];
  }
}

function buildItem(channel: ChannelRow, r: RecordingRow): string {
  const title = r.subject ?? 'Untitled live';
  const permalink = liveUrl(r.join_code);
  const image = r.banner_url ?? channel.banner_url ?? channel.avatar_url;
  const duration = clockDuration(r.duration_seconds);

  return [
    '    <item>',
    `      <title>${escapeXml(title)}</title>`,
    `      <link>${escapeXml(permalink)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(r.id)}</guid>`,
    `      <pubDate>${new Date(r.created_at).toUTCString()}</pubDate>`,
    `      <description>${escapeXml(`${title} — a live from ${channel.name} on PairUX.`)}</description>`,
    // length is required by the RSS spec but the public RPC does not expose
    // size_bytes; 0 is the conventional "unknown" and clients tolerate it.
    `      <enclosure url="${escapeXml(r.playback_url)}" type="video/mp4" length="0"/>`,
    duration ? `      <itunes:duration>${duration}</itunes:duration>` : null,
    image ? `      <itunes:image href="${escapeXml(image)}"/>` : null,
    `      <itunes:author>${escapeXml(channel.name)}</itunes:author>`,
    '    </item>',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  const channel = await getChannel(handle);
  if (!channel) {
    return new Response('Channel not found', { status: 404 });
  }

  const recordings = await getRecordings(handle);
  const channelUrl = `${SITE_URL}/@${channel.handle}`;
  const feedUrl = `${SITE_URL}/c/${encodeURIComponent(channel.handle)}/rss.xml`;
  const description =
    channel.description ?? `Past lives from ${channel.name}, recorded on PairUX.`;
  const artwork = channel.avatar_url ?? channel.banner_url;

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(channel.name)}</title>`,
    `    <link>${escapeXml(channelUrl)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <itunes:author>${escapeXml(channel.name)}</itunes:author>`,
    `    <itunes:summary>${escapeXml(description)}</itunes:summary>`,
    '    <itunes:explicit>false</itunes:explicit>',
    artwork ? `    <itunes:image href="${escapeXml(artwork)}"/>` : null,
    ...recordings.map((r) => buildItem(channel, r)),
    '  </channel>',
    '</rss>',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
