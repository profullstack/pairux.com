import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Lock, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { SITE_URL, clockDuration } from '@/lib/embed';
import { renderDescriptionHtml } from '@/lib/markdown';
import { channelReplay } from '@/lib/live-events/read';
import { replayPath } from '@/lib/live-events/replay';

/**
 * /c/<handle>/replay/<id>: one replay of a scheduled meeting, published on its
 * channel once the occurrence ended. Public replays are open to anybody; private
 * ones only to the channel's managers (get_channel_replay decides, so a private
 * id 404s for everyone else). The meeting's room code is never on this page.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ handle: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle, id } = await params;
  const [r, t] = await Promise.all([channelReplay(handle, id), getTranslations('events')]);
  if (!r) return { title: t('replayNotFound'), robots: { index: false } };
  const title = `${r.subject ?? t('replayUntitled')} · ${r.channel_name} · PairUX`;
  const summary = r.description?.trim().slice(0, 200) ?? '';
  const description =
    summary === '' ? t('replayDescription', { channel: r.channel_name }) : summary;
  const url = `${SITE_URL}${replayPath(r.channel_handle, r.id)}`;
  const image = r.banner_url ?? r.channel_avatar_url;
  return {
    title,
    description,
    alternates: { canonical: url },
    ...(r.is_public ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      title,
      description,
      url,
      type: 'video.other',
      videos: [{ url: r.playback_url, type: 'video/mp4' }],
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function ReplayPage({ params }: PageProps) {
  const { handle, id } = await params;
  const [r, t, locale] = await Promise.all([
    channelReplay(handle, id),
    getTranslations('events'),
    getLocale(),
  ]);
  if (!r) notFound();

  const duration = clockDuration(r.duration_seconds);
  const when = new Date(r.created_at).toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 py-8">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-2xl bg-black">
            <video
              src={r.playback_url}
              poster={r.banner_url ?? undefined}
              controls
              preload="metadata"
              playsInline
              className="aspect-video w-full"
              data-testid="replay-video"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                {r.subject ?? t('replayUntitled')}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {t('replayOn', { date: when })}
                {duration ? ` · ${duration}` : ''}
              </p>
              {!r.is_public && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  <Lock className="h-3.5 w-3.5" />
                  {t('replayPrivateNote')}
                </p>
              )}
            </div>
            <Link
              href={`/@${r.channel_handle}`}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50"
            >
              {r.channel_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.channel_avatar_url}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200">
                  <UserIcon className="h-5 w-5 text-gray-400" />
                </span>
              )}
              <span className="text-sm">
                <span className="block font-semibold text-gray-900">{r.channel_name}</span>
                <span className="text-primary-600 block">@{r.channel_handle}</span>
              </span>
            </Link>
          </div>

          {r.description && (
            <div
              className="[&_a]:text-primary-600 mt-5 max-w-2xl text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderDescriptionHtml(r.description) }}
            />
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
