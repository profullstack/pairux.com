import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Radio, Eye, Circle, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { renderDescriptionHtml } from '@/lib/markdown';
import type { PublicProfile, PublicRoom } from '@pairux/shared-types';

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

async function getRooms(username: string): Promise<PublicRoom[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_public_rooms', {
      p_limit: 100,
      p_username: username,
    });
    if (error) return [];
    return (data as PublicRoom[] | null) ?? [];
  } catch {
    return [];
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
  const [profile, rooms] = await Promise.all([getProfile(username), getRooms(username)]);

  if (!profile) {
    notFound();
  }

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
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Radio className="h-5 w-5 text-red-500" />
              Public rooms
            </h2>

            {rooms.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
                @{handle} has no public rooms right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      {room.is_live ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                          <Circle className="h-2 w-2 animate-pulse fill-current" />
                          Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                          Idle
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Eye className="h-3.5 w-3.5" />
                        {room.viewer_count}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">
                      {room.subject ?? 'Untitled room'}
                    </h3>
                    {room.description && (
                      <div
                        className="[&_a]:text-primary-600 mt-1.5 line-clamp-3 text-sm text-gray-500"
                        dangerouslySetInnerHTML={{
                          __html: renderDescriptionHtml(room.description),
                        }}
                      />
                    )}
                    <Link
                      href={`/join/${room.join_code}`}
                      className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                    >
                      Join room
                    </Link>
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
