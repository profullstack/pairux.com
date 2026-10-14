import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Radio, Eye, Users, Circle, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { renderDescriptionHtml } from '@/lib/markdown';
import type { PublicRoom, Creator } from '@pairux/shared-types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('live.metadata');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/live' },
  };
}

// Public directory changes frequently — always render fresh
export const dynamic = 'force-dynamic';

async function getPublicRooms(): Promise<PublicRoom[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_public_rooms', {
      p_limit: 100,
      p_username: null,
      // Only rooms with a host connected right now — no idle/paused rooms.
      p_live_only: true,
    });
    if (error) {
      console.error('Failed to load public rooms:', error);
      return [];
    }
    return (data as PublicRoom[] | null) ?? [];
  } catch (err) {
    console.error('Failed to load public rooms:', err);
    return [];
  }
}

async function getCreators(): Promise<Creator[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_creators', { p_limit: 24 });
    if (error) return [];
    return (data as Creator[] | null) ?? [];
  } catch {
    return [];
  }
}

function hostLabel(room: PublicRoom, anonymous: string): string {
  return room.host_display_name ?? room.host_username ?? anonymous;
}

export default async function LivePage() {
  const [rooms, creators, t] = await Promise.all([
    getPublicRooms(),
    getCreators(),
    getTranslations('live'),
  ]);

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
                {t('title')}
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {t.rich('intro', {
                  link: (chunks) => (
                    <Link href="/channels" className="text-primary-600 font-medium hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {rooms.length === 0 ? (
              <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-10 text-center">
                <Radio className="mx-auto h-10 w-10 text-gray-300" />
                <h2 className="mt-4 text-lg font-semibold text-gray-900">{t('empty.title')}</h2>
                <p className="mt-2 text-sm text-gray-500">
                  {t.rich('empty.body', { strong: (chunks) => <strong>{chunks}</strong> })}
                </p>
                <Link
                  href="/host"
                  className="bg-primary-600 hover:bg-primary-700 mt-6 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                >
                  {t('empty.cta')}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {rooms.map((room) => (
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
                          {t('badgeLive')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                          {t('badgeIdle')}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Eye className="h-3.5 w-3.5" />
                        {t('viewers', { count: room.viewer_count })}
                      </span>
                    </div>

                    <Link
                      href={`/l/${room.join_code}`}
                      className="text-base font-semibold text-gray-900 hover:underline"
                    >
                      {room.subject ?? t('untitledRoom')}
                    </Link>
                    {room.description && (
                      <div
                        className="[&_a]:text-primary-600 mt-1.5 line-clamp-3 text-sm text-gray-500"
                        // Safe: renderDescriptionHtml escapes all HTML, then applies a small markdown allowlist.
                        dangerouslySetInnerHTML={{
                          __html: renderDescriptionHtml(room.description),
                        }}
                      />
                    )}

                    <div className="mt-4 flex items-center gap-1.5 text-sm text-gray-600">
                      <Users className="h-4 w-4 text-gray-400" />
                      {room.channel_handle ? (
                        <Link
                          href={`/@${room.channel_handle}`}
                          className="text-primary-600 hover:underline"
                        >
                          {room.channel_name ?? `@${room.channel_handle}`}
                        </Link>
                      ) : room.host_username ? (
                        <Link
                          href={`/u/${room.host_username}`}
                          className="text-primary-600 hover:underline"
                        >
                          {hostLabel(room, t('anonymous'))}
                        </Link>
                      ) : (
                        <span>{hostLabel(room, t('anonymous'))}</span>
                      )}
                    </div>

                    <Link
                      href={`/join/${room.join_code}`}
                      className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                    >
                      {t('joinRoom')}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {creators.length > 0 && (
          <section className="pb-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <Users className="h-5 w-5 text-gray-400" />
                {t('creators')}
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {creators.map((c) => (
                  <Link
                    key={c.username}
                    href={`/u/${c.username}`}
                    className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-5 text-center transition-shadow hover:shadow-md"
                  >
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatar_url}
                        alt=""
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-200">
                        <UserIcon className="h-7 w-7 text-gray-400" />
                      </div>
                    )}
                    <p className="mt-3 line-clamp-1 text-sm font-semibold text-gray-900">
                      {c.display_name ?? `@${c.username}`}
                    </p>
                    <p className="text-primary-600 line-clamp-1 text-xs">@{c.username}</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      {c.is_live && (
                        <span className="inline-flex items-center gap-1 font-medium text-red-600">
                          <Circle className="h-2 w-2 animate-pulse fill-current" />
                          {t('badgeLive')}
                        </span>
                      )}
                      <span>{t('followers', { count: c.follower_count })}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
