import type { Metadata } from 'next';
import Link from 'next/link';
import { Radio, Eye, Users, Circle } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import type { PublicRoom } from '@pairux/shared-types';

export const metadata: Metadata = {
  title: 'Live Rooms',
  description: 'Browse public screen-sharing rooms happening now on PairUX.',
  alternates: { canonical: 'https://pairux.com/live' },
};

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

function hostLabel(room: PublicRoom): string {
  return room.host_display_name ?? room.host_username ?? 'Anonymous';
}

export default async function LivePage() {
  const rooms = await getPublicRooms();

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
                Live Rooms
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Public screen-sharing rooms hosts have chosen to share with everyone. Jump into one,
                no invite needed.
              </p>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {rooms.length === 0 ? (
              <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-10 text-center">
                <Radio className="mx-auto h-10 w-10 text-gray-300" />
                <h2 className="mt-4 text-lg font-semibold text-gray-900">No public rooms yet</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Host a session and use <strong>Publish to /live</strong> to list it here.
                </p>
                <Link
                  href="/host"
                  className="bg-primary-600 hover:bg-primary-700 mt-6 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                >
                  Start hosting
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                        {room.viewer_count} {room.viewer_count === 1 ? 'viewer' : 'viewers'}
                      </span>
                    </div>

                    <h3 className="text-base font-semibold text-gray-900">
                      {room.subject ?? 'Untitled room'}
                    </h3>
                    {room.description && (
                      <p className="mt-1.5 line-clamp-3 text-sm text-gray-500">
                        {room.description}
                      </p>
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
