import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Circle, Eye, MessageSquare, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { renderDescriptionHtml } from '@/lib/markdown';
import { SITE_URL, embedUrl, iframeSnippet, liveUrl, oembedUrl } from '@/lib/embed';
import type { PublicSessionDetail, SessionComment } from '@pairux/shared-types';
import { RecordingPlayer } from '@/components/video/RecordingPlayer';
import { LikeButton } from './LikeButton';
import { Comments } from './Comments';
import { EmbedButton } from './EmbedButton';

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

async function getComments(sessionId: string): Promise<SessionComment[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('list_comments', {
      p_session_id: sessionId,
      p_limit: 200,
    });
    return (data as SessionComment[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { joinCode } = await params;
  const s = await getSession(joinCode);
  if (!s) return { title: 'Live not found' };
  const title = s.subject ?? 'Live on PairUX';
  const description =
    s.description ?? `A public live by ${s.host_display_name ?? 'a PairUX creator'}.`;
  return {
    title,
    description,
    alternates: {
      canonical: liveUrl(s.join_code),
      // Lets Slack, Notion, WordPress and friends discover the player and turn
      // a pasted permalink into an embed.
      types: { 'application/json+oembed': oembedUrl(s.join_code) },
    },
    openGraph: {
      title,
      description,
      type: 'video.other',
      url: liveUrl(s.join_code),
      ...(s.banner_url ? { images: [{ url: s.banner_url }] } : {}),
    },
    twitter: {
      card: 'player',
      title,
      description,
      ...(s.banner_url ? { images: [s.banner_url] } : {}),
    },
  };
}

/** schema.org VideoObject so a finished live can surface as a video result. */
function videoSchema(s: PublicSessionDetail): Record<string, unknown> {
  const title = s.subject ?? 'Live on PairUX';
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: title,
    description: s.description ?? `A public live by ${s.host_display_name ?? 'a PairUX creator'}.`,
    uploadDate: s.published_at ?? s.created_at,
    url: liveUrl(s.join_code),
    embedUrl: embedUrl(s.join_code),
    publisher: { '@type': 'Organization', name: 'PairUX', url: SITE_URL },
  };
  if (s.banner_url) schema.thumbnailUrl = [s.banner_url];
  if (s.recording_url) schema.contentUrl = s.recording_url;
  if (s.channel_name ?? s.host_display_name ?? s.host_username) {
    schema.author = {
      '@type': 'Person',
      name: s.channel_name ?? s.host_display_name ?? s.host_username,
    };
  }
  return schema;
}

function hostName(s: PublicSessionDetail): string {
  return s.host_display_name ?? (s.host_username ? `@${s.host_username}` : 'Anonymous');
}

export default async function LiveDetailPage({ params }: PageProps) {
  const { joinCode } = await params;
  const session = await getSession(joinCode);
  if (!session) notFound();

  const comments = await getComments(session.id);
  const when = session.published_at ?? session.created_at;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const snippet = iframeSnippet(session.join_code, { title: session.subject });
  // A stream is credited to its channel when it has one — see the name link
  // below — so the avatar follows the same precedence.
  const avatarUrl = session.channel_avatar_url ?? session.host_avatar_url;

  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema(session)) }}
      />
      <Header />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          {session.recording_url && !session.is_live ? (
            <RecordingPlayer
              src={session.recording_url}
              mediaId={`session:${session.join_code}`}
              poster={session.banner_url}
              className="mb-6 aspect-video w-full overflow-hidden rounded-2xl bg-black"
            />
          ) : (
            session.banner_url && (
              <div className="mb-6 aspect-video w-full overflow-hidden rounded-2xl bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={session.banner_url}
                  alt=""
                  className="h-full w-full object-cover object-center"
                />
              </div>
            )
          )}

          <div className="mb-2 flex items-center gap-3">
            {session.is_live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                <Circle className="h-2 w-2 animate-pulse fill-current" />
                Live now
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                {new Date(when).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            )}
            {session.is_live && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Eye className="h-3.5 w-3.5" />
                {session.viewer_count}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            {session.subject ?? 'Untitled live'}
          </h1>

          <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200">
                <UserIcon className="h-4 w-4 text-gray-400" />
              </div>
            )}
            {session.channel_handle ? (
              <Link
                href={`/@${session.channel_handle}`}
                className="text-primary-600 hover:underline"
              >
                {session.channel_name ?? `@${session.channel_handle}`}
              </Link>
            ) : session.host_username ? (
              <Link
                href={`/u/${session.host_username}`}
                className="text-primary-600 hover:underline"
              >
                {hostName(session)}
              </Link>
            ) : (
              <span>{hostName(session)}</span>
            )}
          </div>

          {session.description && (
            <div
              className="[&_a]:text-primary-600 mt-4 text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderDescriptionHtml(session.description) }}
            />
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <LikeButton
              sessionId={session.id}
              joinCode={session.join_code}
              initialLiked={session.liked}
              initialCount={session.like_count}
            />
            {session.is_live && (
              <Link
                href={`/join/${session.join_code}`}
                className="bg-primary-600 hover:bg-primary-700 inline-flex items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors"
              >
                Watch for free
              </Link>
            )}
          </div>

          <div className="mt-4">
            <EmbedButton snippet={snippet} />
          </div>

          <section className="mt-10 border-t border-gray-200 pt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <MessageSquare className="h-5 w-5 text-gray-400" />
              Comments ({session.comment_count})
            </h2>
            <Comments
              sessionId={session.id}
              joinCode={session.join_code}
              initialComments={comments}
            />
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
