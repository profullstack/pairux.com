import type { Metadata } from 'next';
import Link from 'next/link';
import { Radio, Eye, Users, Circle } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { renderDescriptionHtml } from '@/lib/markdown';
import type { PublicRoom } from '@pairux/shared-types';

export const metadata: Metadata = {
  title: 'Channels',
  description: 'Every public live on PairUX — past and present.',
  alternates: { canonical: 'https://pairux.com/channels' },
};

export const dynamic = 'force-dynamic';

async function getChannels(): Promise<PublicRoom[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_channels', {
      p_limit: 100,
      p_offset: 0,
    });
    if (error) {
      console.error('Failed to load channels:', error);
      return [];
    }
    return (data as PublicRoom[] | null) ?? [];
  } catch (err) {
    console.error('Failed to load channels:', err);
    return [];
  }
}

function hostLabel(room: PublicRoom): string {
  return room.host_display_name ?? room.host_username ?? 'Anonymous';
}

function whenLabel(room: PublicRoom): string {
  if (room.is_live) return 'Live now';
  const iso = room.published_at ?? room.created_at;
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

export default async function ChannelsPage() {
  const channels = await getChannels();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <Radio className="h-6 w-6 text-red-600" />
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                Channels
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Every public live on PairUX — past and present. Looking for what&apos;s on right
                now?{' '}
                <Link href="/live" className="text-primary-600 font-medium hover:underline">
                  Go to Live
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {channels.length === 0 ? (
              <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-10 text-center">
                <Radio className="mx-auto h-10 w-10 text-gray-300" />
                <h2 className="mt-4 text-lg font-semibold text-gray-900">No public lives yet</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Host a session and use <strong>Publish to /live</strong> — it&apos;ll appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {channels.map((room) => (
                  <div
                    key={room.id}
                    className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
                  >
                    {room.banner_url && (
                      <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg bg-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={room.banner_url}
                          alt=""
                          className="h-full w-full object-cover object-center"
                        />
                      </div>
                    )}
                    <div className="mb-3 flex items-center justify-between">
                      {room.is_live ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                          <Circle className="h-2 w-2 animate-pulse fill-current" />
                          Live now
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                          {whenLabel(room)}
                        </span>
                      )}
                      {room.is_live && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Eye className="h-3.5 w-3.5" />
                          {room.viewer_count}
                        </span>
                      )}
                    </div>

                    <Link
                      href={`/l/${room.join_code}`}
                      className="text-base font-semibold text-gray-900 hover:underline"
                    >
                      {room.subject ?? 'Untitled room'}
                    </Link>
                    {room.description && (
                      <div
                        className="[&_a]:text-primary-600 mt-1.5 line-clamp-3 text-sm text-gray-500"
                        dangerouslySetInnerHTML={{
                          __html: renderDescriptionHtml(room.description),
                        }}
                      />
                    )}

                    <div className="mt-4 flex items-center gap-1.5 text-sm text-gray-600">
                      <Users className="h-4 w-4 text-gray-400" />
                      {room.host_username ? (
                        <Link
                          href={`/u/${room.host_username}`}
                          className="text-primary-600 hover:underline"
                        >
                          {hostLabel(room)}
                        </Link>
                      ) : (
                        <span>{hostLabel(room)}</span>
                      )}
                    </div>

                    {room.is_live && (
                      <Link
                        href={`/join/${room.join_code}`}
                        className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                      >
                        Join room
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
