import type { Metadata } from 'next';
import Link from 'next/link';
import { Radio, Circle, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Channels',
  description: 'Browse creator channels on PairUX.',
  alternates: { canonical: 'https://pairux.com/channels' },
};

export const dynamic = 'force-dynamic';

interface ChannelDir {
  handle: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  subscriber_count: number;
  is_live: boolean;
}

async function getChannels(): Promise<ChannelDir[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('list_all_channels', { p_limit: 60 });
    if (error) return [];
    return (data as ChannelDir[] | null) ?? [];
  } catch {
    return [];
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
                Creator channels on PairUX. Subscribe to get notified when they go live — or see
                who&apos;s{' '}
                <Link href="/live" className="text-primary-600 font-medium hover:underline">
                  live right now
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
                <h2 className="mt-4 text-lg font-semibold text-gray-900">No channels yet</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Create one from your{' '}
                  <Link href="/dashboard" className="text-primary-600 hover:underline">
                    dashboard
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {channels.map((c) => (
                  <Link
                    key={c.handle}
                    href={`/c/${c.handle}`}
                    className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
                  >
                    {c.banner_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.banner_url} alt="" className="aspect-[6/1] w-full object-cover" />
                    ) : (
                      <div className="gradient-bg aspect-[6/1] w-full" />
                    )}
                    <div className="flex items-center gap-3 p-5">
                      {c.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.avatar_url}
                          alt=""
                          className="-mt-10 h-14 w-14 rounded-full border-2 border-white object-cover"
                        />
                      ) : (
                        <div className="-mt-10 flex h-14 w-14 items-center justify-center rounded-full border-2 border-white bg-gray-200">
                          <UserIcon className="h-7 w-7 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="line-clamp-1 text-sm font-semibold text-gray-900">
                            {c.name}
                          </p>
                          {c.is_live && (
                            <span className="inline-flex items-center gap-1 font-medium text-red-600">
                              <Circle className="h-2 w-2 animate-pulse fill-current" />
                            </span>
                          )}
                        </div>
                        <p className="text-primary-600 line-clamp-1 text-xs">@{c.handle}</p>
                        <p className="text-xs text-gray-500">
                          {c.subscriber_count}{' '}
                          {c.subscriber_count === 1 ? 'subscriber' : 'subscribers'}
                        </p>
                      </div>
                    </div>
                  </Link>
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
