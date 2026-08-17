import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EMBED_HEIGHT, EMBED_WIDTH, SITE_URL, iframeSnippet, joinCodeFromUrl } from '@/lib/embed';
import type { PublicSessionDetail } from '@pairux/shared-types';

/**
 * oEmbed provider endpoint (https://oembed.com) for PairUX lives.
 *
 * Consumers (Slack, Notion, WordPress, Ghost, Discord) discover this via the
 * <link rel="alternate" type="application/json+oembed"> tag on /l/<joinCode>
 * and turn a pasted permalink into the embedded player.
 */

export const dynamic = 'force-dynamic';

/** Height of the title bar under the 16:9 video in the embed page. */
const CHROME_HEIGHT = EMBED_HEIGHT - Math.round((EMBED_WIDTH * 9) / 16);

async function getSession(joinCode: string): Promise<PublicSessionDetail | null> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_public_session', {
      p_join_code: joinCode,
    });
    if (error) return null;
    return (data as PublicSessionDetail[] | null)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Parse a positive integer query param, ignoring junk. */
function positiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const url = searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing required "url" parameter' }, { status: 400 });
  }

  // The spec allows providers to support only json; anything else is a 501.
  const format = searchParams.get('format');
  if (format && format !== 'json') {
    return NextResponse.json({ error: `Unsupported format "${format}"` }, { status: 501 });
  }

  const joinCode = joinCodeFromUrl(url);
  if (!joinCode) {
    return NextResponse.json({ error: 'Not a PairUX live URL' }, { status: 404 });
  }

  const session = await getSession(joinCode);
  if (!session) {
    return NextResponse.json({ error: 'Live not found' }, { status: 404 });
  }

  // Honour maxwidth/maxheight, keeping the 16:9 video plus the title bar.
  const maxWidth = positiveInt(searchParams.get('maxwidth'));
  const maxHeight = positiveInt(searchParams.get('maxheight'));
  let width = Math.min(maxWidth ?? EMBED_WIDTH, EMBED_WIDTH);
  let height = Math.round((width * 9) / 16) + CHROME_HEIGHT;
  if (maxHeight && height > maxHeight) {
    height = maxHeight;
    width = Math.round(((height - CHROME_HEIGHT) * 16) / 9);
  }

  const title = session.subject ?? 'Live on PairUX';
  const authorName = session.channel_name ?? session.host_display_name ?? session.host_username;
  const authorUrl = session.channel_handle
    ? `${SITE_URL}/@${session.channel_handle}`
    : session.host_username
      ? `${SITE_URL}/u/${session.host_username}`
      : null;

  const payload: Record<string, string | number> = {
    type: 'video',
    version: '1.0',
    provider_name: 'PairUX',
    provider_url: SITE_URL,
    title,
    html: iframeSnippet(session.join_code, { width, height, title }),
    width,
    height,
  };
  if (authorName) payload.author_name = authorName;
  if (authorUrl) payload.author_url = authorUrl;
  if (session.banner_url) payload.thumbnail_url = session.banner_url;

  return NextResponse.json(payload, {
    headers: {
      // Live state changes; a short cache keeps unfurl services from hammering us
      // without pinning a stale "Live now" for long.
      'cache-control': 'public, max-age=60, s-maxage=60',
    },
  });
}
