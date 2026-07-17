import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ArrowLeft, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import type { DmMessage, PublicProfile } from '@pairux/shared-types';
import { Thread } from './Thread';

export const metadata: Metadata = {
  title: 'Conversation',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ username: string }>;
}

async function getProfile(username: string): Promise<PublicProfile | null> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_public_profile', { p_username: username });
    return ((data as PublicProfile[] | null) ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

async function getConversation(username: string): Promise<DmMessage[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_dm_conversation', {
      p_username: username,
      p_limit: 200,
    });
    return (data as DmMessage[] | null) ?? [];
  } catch {
    return [];
  }
}

export default async function ConversationPage({ params }: PageProps) {
  const { username } = await params;
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) {
    redirect(`/login?next=/messages/${username}`);
  }

  const profile = await getProfile(username);
  if (!profile?.username) {
    notFound();
  }
  if (profile.id === user.id) {
    redirect('/messages');
  }

  const messages = await getConversation(username);
  const handle = profile.username;
  const name = profile.display_name ?? `@${handle}`;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="py-8">
          <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
            <Link
              href="/messages"
              className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              All messages
            </Link>

            <div className="mb-4 flex items-center gap-3">
              <Link href={`/u/${handle}`}>
                {profile.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-200">
                    <UserIcon className="h-6 w-6 text-gray-400" />
                  </div>
                )}
              </Link>
              <div>
                <Link
                  href={`/u/${handle}`}
                  className="text-base font-semibold text-gray-900 hover:underline"
                >
                  {name}
                </Link>
                <p className="text-primary-600 text-xs">@{handle}</p>
              </div>
            </div>

            <Thread username={handle} displayName={name} initialMessages={messages} />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
