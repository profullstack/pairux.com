import { buildIcs, icsFilename } from '@/lib/calendar';
import { SITE_URL } from '@/lib/embed';
import { toCalendarEvent, viewerOccurrence } from '@/lib/live-events/public';
import { publicEvent } from '@/lib/live-events/read';

/** One public event as an .ics download (Apple Calendar, Thunderbird, anything). */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await publicEvent(id);
  const occ = row ? viewerOccurrence(row, new Date()) : null;
  if (!row || !occ) return new Response('Event not found', { status: 404 });
  return new Response(buildIcs(toCalendarEvent(row, occ, SITE_URL)), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(row.title)}"`,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
