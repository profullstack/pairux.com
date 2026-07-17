import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageCircle, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import type { DmThread } from '@pairux/shared-types';

export const metadata: Metadata = {
  title: 'Messages',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

async function getThreads(): Promise<DmThread[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('list_dm_threads');
    return (data as DmThread[] | null) ?? [];
  } catch {
    return [];
  }
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default async function MessagesPage() {
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) {
    redirect('/login?next=/messages');
  }

  const threads = await getThreads();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="py-12">
          <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
            <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-gray-900">
              <MessageCircle className="h-6 w-6 text-red-500" />
              Messages
            </h1>

            {threads.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
                <MessageCircle className="mx-auto h-10 w-10 text-gray-300" />
                <h2 className="mt-4 text-lg font-semibold text-gray-900">No messages yet</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Visit a creator&apos;s profile and hit <strong>Message</strong> to start a
                  conversation.
                </p>
                <Link
                  href="/live"
                  className="text-primary-600 mt-4 inline-block text-sm font-medium hover:underline"
                >
                  Browse creators →
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                {threads.map((t) => {
                  const name = t.display_name;
                  const unread = t.unread_count > 0;
                  return (
                    <li key={t.partner_id}>
                      <Link
                        href={`/messages/${t.addr}`}
                        className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-gray-50"
                      >
                        {t.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.avatar_url}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-200">
                            <UserIcon className="h-6 w-6 text-gray-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={`truncate text-sm ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}
                            >
                              {name}
                            </p>
                            <span className="shrink-0 text-xs text-gray-400">
                              {timeLabel(t.last_created_at)}
                            </span>
                          </div>
                          <p
                            className={`truncate text-sm ${unread ? 'font-medium text-gray-700' : 'text-gray-500'}`}
                          >
                            {t.last_from_me && <span className="text-gray-400">You: </span>}
                            {t.last_body}
                          </p>
                        </div>
                        {unread && (
                          <span className="bg-primary-600 ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white">
                            {t.unread_count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
