import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Radio, Eye, Circle, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { renderDescriptionHtml } from '@/lib/markdown';
import type { PublicProfile, CreatorLive, FollowState } from '@pairux/shared-types';
import { FollowButton } from './FollowButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ username: string }>;
}

async function getProfile(username: string): Promise<PublicProfile | null> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_public_profile', {
      p_username: username,
    });
    if (error) {
      console.error('Failed to load profile:', error);
      return null;
    }
    const rows = (data as PublicProfile[] | null) ?? [];
    return rows[0] ?? null;
  } catch (err) {
    console.error('Failed to load profile:', err);
    return null;
  }
}

async function getLives(username: string): Promise<CreatorLive[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_creator_lives', {
      p_username: username,
      p_limit: 100,
    });
    if (error) return [];
    return (data as CreatorLive[] | null) ?? [];
  } catch {
    return [];
  }
}

async function getFollowState(creatorId: string): Promise<FollowState> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_follow_state', {
      p_creator_id: creatorId,
    });
    const row = (data as FollowState[] | null)?.[0];
    return row ?? { follower_count: 0, is_following: false };
  } catch {
    return { follower_count: 0, is_following: false };
  }
}

interface UserChannel {
  handle: string;
  name: string;
  avatar_url: string | null;
  banner_url: string | null;
  subscriber_count: number;
  is_live: boolean;
}

async function getUserChannels(username: string): Promise<UserChannel[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('list_user_channels', { p_username: username });
    return (data as UserChannel[] | null) ?? [];
  } catch {
    return [];
  }
}

function whenLabel(live: CreatorLive): string {
  if (live.is_live) return 'Live now';
  const iso = live.published_at ?? live.created_at;
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfile(username);
  if (!profile) {
    return { title: 'Profile not found' };
  }
  const name = profile.display_name ?? `@${profile.username ?? username}`;
  return {
    title: `${name} (@${profile.username ?? username})`,
    description: profile.bio ?? `${name}'s public rooms on PairUX.`,
    alternates: { canonical: `https://pairux.com/u/${profile.username ?? username}` },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    notFound();
  }

  const [lives, followState, channels] = await Promise.all([
    getLives(username),
    getFollowState(profile.id),
    getUserChannels(username),
  ]);

  const handle = profile.username ?? username;
  const name = profile.display_name ?? `@${handle}`;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={name}
                  className="h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200">
                  <UserIcon className="h-10 w-10 text-gray-400" />
                </div>
              )}
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-900">{name}</h1>
              <p className="text-primary-600 mt-1 text-sm font-medium">@{handle}</p>
              {profile.bio && <p className="mx-auto mt-4 max-w-xl text-gray-600">{profile.bio}</p>}
              <FollowButton
                username={handle}
                initialFollowing={followState.is_following}
                initialCount={followState.follower_count}
              />
            </div>
          </div>
        </section>

        {channels.length > 0 && (
          <section className="border-b border-gray-100 py-12">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
              <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <Radio className="h-5 w-5 text-red-500" />
                Channels
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {channels.map((c) => (
                  <Link
                    key={c.handle}
                    href={`/@${c.handle}`}
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
                      {c.name}
                    </p>
                    <p className="text-primary-600 line-clamp-1 text-xs">@{c.handle}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      {c.is_live && (
                        <span className="inline-flex items-center gap-1 font-medium text-red-600">
                          <Circle className="h-2 w-2 animate-pulse fill-current" />
                          Live
                        </span>
                      )}
                      <span>{c.subscriber_count} subs</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="py-12">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Radio className="h-5 w-5 text-red-500" />
              Lives
            </h2>

            {lives.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
                @{handle} hasn&apos;t gone live yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {lives.map((live) => (
                  <div
                    key={live.id}
                    className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
                  >
                    {live.banner_url && (
                      <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg bg-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={live.banner_url}
                          alt=""
                          className="h-full w-full object-cover object-center"
                        />
                      </div>
                    )}
                    <div className="mb-3 flex items-center justify-between">
                      {live.is_live ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                          <Circle className="h-2 w-2 animate-pulse fill-current" />
                          Live now
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                          {whenLabel(live)}
                        </span>
                      )}
                      {live.is_live && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Eye className="h-3.5 w-3.5" />
                          {live.viewer_count}
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/l/${live.join_code}`}
                      className="text-base font-semibold text-gray-900 hover:underline"
                    >
                      {live.subject ?? 'Untitled room'}
                    </Link>
                    {live.description && (
                      <div
                        className="[&_a]:text-primary-600 mt-1.5 line-clamp-3 text-sm text-gray-500"
                        dangerouslySetInnerHTML={{
                          __html: renderDescriptionHtml(live.description),
                        }}
                      />
                    )}
                    {live.is_live && (
                      <Link
                        href={`/join/${live.join_code}`}
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
