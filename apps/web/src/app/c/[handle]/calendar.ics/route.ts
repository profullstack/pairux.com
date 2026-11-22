import { buildIcsFeed } from '@/lib/calendar';
import { SITE_URL } from '@/lib/embed';
import { channelWatchUrl, toCalendarEvent, upcoming } from '@/lib/live-events/public';
import { channelEvents, publicChannel } from '@/lib/live-events/read';

/**
 * A channel's live schedule as a subscribable calendar (webcal://...).
 * Calendar apps poll it, so an event moved or cancelled by the host updates
 * or disappears for every subscriber without them doing anything.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const channel = await publicChannel(handle);
  if (!channel) return new Response('Channel not found', { status: 404 });

  const now = new Date();
  const events = upcoming(await channelEvents(channel.handle), now).map(({ row, occ }) =>
    toCalendarEvent(row, occ, SITE_URL)
  );
  const body = buildIcsFeed(
    {
      name: `${channel.name} live on PairUX`,
      description: channel.description ?? `Live streams from ${channel.name}`,
      url: channelWatchUrl(SITE_URL, channel.handle),
    },
    events,
    now
  );
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${channel.handle}-live.ics"`,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
