import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Radio, Eye, Circle, PlayCircle, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { renderDescriptionHtml } from '@/lib/markdown';
import type { Channel, ChannelStream, ChannelRecording } from '@pairux/shared-types';
import { SubscribeButton } from './SubscribeButton';
import { ShareButtons } from './ShareButtons';
import { MessageButton } from '@/app/u/[username]/MessageButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ handle: string }>;
}

async function getChannel(handle: string): Promise<Channel | null> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_channel', { p_handle: handle });
    return (data as Channel[] | null)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getViewer(): Promise<{ id: string } | null> {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    return user ? { id: user.id } : null;
  } catch {
    return null;
  }
}

async function getStreams(handle: string): Promise<ChannelStream[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('list_channel_streams', {
      p_handle: handle,
      p_limit: 60,
    });
    return (data as ChannelStream[] | null) ?? [];
  } catch {
    return [];
  }
}

async function getRecordings(handle: string): Promise<ChannelRecording[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('list_channel_recordings', {
      p_handle: handle,
      p_limit: 60,
    });
    return (data as ChannelRecording[] | null) ?? [];
  } catch {
    return [];
  }
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds < 1) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${String(m)}:${pad(s)}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const ch = await getChannel(handle);
  if (!ch) return { title: 'Channel not found' };
  const title = `${ch.name} (@${ch.handle})`;
  const description = ch.description ?? `${ch.name}'s channel on PairUX.`;
  const url = `https://pairux.com/@${ch.handle}`;
  // og:image — prefer the 6:1 banner, fall back to the square avatar.
  const image = ch.banner_url
    ? { url: ch.banner_url, width: 1500, height: 250 }
    : ch.avatar_url
      ? { url: ch.avatar_url, width: 400, height: 400 }
      : null;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image.url] } : {}),
    },
  };
}

function streamWhen(s: ChannelStream): string {
  if (s.is_live) return 'Live now';
  const iso = s.published_at ?? s.created_at;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default async function ChannelPage({ params }: PageProps) {
  const { handle } = await params;
  const channel = await getChannel(handle);
  if (!channel) notFound();

  const [streams, recordings, viewer] = await Promise.all([
    getStreams(handle),
    getRecordings(handle),
    getViewer(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {channel.banner_url ? (
          <div className="aspect-[6/1] w-full overflow-hidden bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={channel.banner_url}
              alt=""
              className="h-full w-full object-cover object-center"
            />
          </div>
        ) : (
          <div className="gradient-bg h-24 w-full sm:h-32" />
        )}

        <section className="border-b border-gray-200">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              {channel.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={channel.avatar_url}
                  alt={channel.name}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
                  <UserIcon className="h-8 w-8 text-gray-400" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    {channel.name}
                  </h1>
                  {channel.is_live && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                      <Circle className="h-2 w-2 animate-pulse fill-current" />
                      Live
                    </span>
                  )}
                  {channel.is_live && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <Eye className="h-3.5 w-3.5" />
                      {channel.live_viewers} watching
                    </span>
                  )}
                </div>
                <p className="text-primary-600 text-sm font-medium">@{channel.handle}</p>
                {channel.description && (
                  <div
                    className="[&_a]:text-primary-600 mt-1 max-w-xl text-sm text-gray-600"
                    dangerouslySetInnerHTML={{ __html: renderDescriptionHtml(channel.description) }}
                  />
                )}
              </div>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end sm:self-start">
              {channel.is_owner ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Manage channel
                </Link>
              ) : (
                <div className="flex items-center gap-2">
                  <SubscribeButton
                    handle={channel.handle}
                    initialSubscribed={channel.is_subscribed}
                    initialCount={channel.subscriber_count}
                  />
                  {channel.owner_addr && (
                    <MessageButton
                      addr={channel.owner_addr}
                      displayName={channel.name}
                      isAuthed={viewer !== null}
                    />
                  )}
                </div>
              )}
              <ShareButtons handle={channel.handle} name={channel.name} />
            </div>
          </div>
        </section>

        <section className="py-10">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Radio className="h-5 w-5 text-red-500" />
              Streams
            </h2>
            {streams.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
                No streams yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {streams.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <Link href={`/l/${s.join_code}`} className="block">
                      <div className="aspect-video w-full overflow-hidden rounded-lg bg-gray-100">
                        {s.banner_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.banner_url}
                            alt=""
                            className="h-full w-full object-cover object-center"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Radio className="h-8 w-8 text-gray-300" />
                          </div>
                        )}
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-gray-900">
                        {s.subject ?? 'Untitled stream'}
                      </h3>
                    </Link>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      {s.is_live ? (
                        <span className="inline-flex items-center gap-1 font-medium text-red-600">
                          <Circle className="h-2 w-2 animate-pulse fill-current" />
                          Live
                        </span>
                      ) : (
                        <span>{streamWhen(s)}</span>
                      )}
                      {s.is_live && (
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3.5 w-3.5" />
                          {s.viewer_count}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {recordings.length > 0 && (
          <section className="border-t border-gray-100 py-10">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
              <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <PlayCircle className="h-5 w-5 text-gray-400" />
                Recordings
              </h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {recordings.map((r) => {
                  const dur = formatDuration(r.duration_seconds);
                  return (
                    <Link
                      key={r.id}
                      href={`/l/${r.join_code}`}
                      className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-gray-100">
                        {r.banner_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.banner_url}
                            alt=""
                            className="h-full w-full object-cover object-center"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <PlayCircle className="h-8 w-8 text-gray-300" />
                          </div>
                        )}
                        <span className="absolute inset-0 flex items-center justify-center">
                          <PlayCircle className="h-10 w-10 text-white/90 drop-shadow" />
                        </span>
                        {dur && (
                          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                            {dur}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-gray-900">
                        {r.subject ?? 'Recording'}
                      </h3>
                      <span className="mt-2 text-xs text-gray-500">
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
