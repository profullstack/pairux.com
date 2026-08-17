import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Circle, Play } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { SITE_URL, liveUrl } from '@/lib/embed';
import type { PublicSessionDetail } from '@pairux/shared-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ joinCode: string }>;
}

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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { joinCode } = await params;
  const session = await getSession(joinCode);
  return {
    title: session?.subject ?? 'PairUX player',
    // The permalink at /l/<joinCode> is the canonical, indexable page. The
    // player is a bare duplicate of it, so keep it out of search results.
    robots: { index: false, follow: false },
  };
}

export default async function EmbedPlayerPage({ params }: PageProps) {
  const { joinCode } = await params;
  const session = await getSession(joinCode);
  if (!session) notFound();

  const permalink = liveUrl(session.join_code);
  const title = session.subject ?? 'Untitled live';
  const byline = session.channel_name ?? session.host_display_name ?? session.host_username ?? null;
  // Absolute, because these links open out of the iframe into a new tab.
  const channelUrl = session.channel_handle
    ? `${SITE_URL}/@${session.channel_handle}`
    : session.host_username
      ? `${SITE_URL}/u/${session.host_username}`
      : permalink;
  const showRecording = Boolean(session.recording_url) && !session.is_live;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black">
      <div className="relative min-h-0 flex-1">
        {showRecording ? (
          <video
            controls
            playsInline
            preload="metadata"
            poster={session.banner_url ?? undefined}
            src={session.recording_url ?? undefined}
            className="h-full w-full bg-black"
          >
            Your browser does not support video playback.
          </video>
        ) : (
          <a
            href={permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block h-full w-full"
          >
            {session.banner_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.banner_url}
                alt=""
                className="h-full w-full object-cover object-center opacity-80 transition-opacity group-hover:opacity-100"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-gray-800 to-black" />
            )}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 transition-transform group-hover:scale-105">
                <Play className="ml-1 h-7 w-7 fill-gray-900 text-gray-900" />
              </span>
              <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                {session.is_live ? 'Watch live on PairUX' : 'Watch on PairUX'}
              </span>
            </span>
          </a>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 bg-neutral-950 px-4 py-3">
        {session.is_live && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-400">
            <Circle className="h-2 w-2 animate-pulse fill-current" />
            Live
          </span>
        )}
        <div className="min-w-0 flex-1">
          <a
            href={permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-1 text-sm font-semibold text-white hover:underline"
          >
            {title}
          </a>
          {byline && (
            <a
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-1 text-xs text-gray-400 hover:text-gray-200 hover:underline"
            >
              {byline}
            </a>
          )}
        </div>
        <a
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-gray-200 transition-colors hover:bg-white/20"
        >
          PairUX
        </a>
      </div>
    </div>
  );
}
