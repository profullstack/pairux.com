import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ArrowLeft, User as UserIcon } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import type { DmMessage, DmPartner } from '@pairux/shared-types';
import { Thread } from './Thread';

export const metadata: Metadata = {
  title: 'Conversation',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

// The [username] segment is a DM address: a username, or a user id for
// accounts that have no username.
interface PageProps {
  params: Promise<{ username: string }>;
}

async function getPartner(addr: string): Promise<DmPartner | null> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_dm_partner', { p_addr: addr });
    return ((data as DmPartner[] | null) ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

async function getConversation(addr: string): Promise<DmMessage[]> {
  try {
    const supabase = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_dm_conversation', {
      p_username: addr,
      p_limit: 200,
    });
    return (data as DmMessage[] | null) ?? [];
  } catch {
    return [];
  }
}

export default async function ConversationPage({ params }: PageProps) {
  const { username: addr } = await params;
  const supabase = await createClient();
  const { user } = await getAuthenticatedUser(supabase);
  if (!user) {
    redirect(`/login?next=/messages/${addr}`);
  }

  const partner = await getPartner(addr);
  if (!partner) {
    notFound();
  }
  if (partner.id === user.id) {
    redirect('/messages');
  }

  const messages = await getConversation(addr);
  const name = partner.display_name ?? (partner.username ? `@${partner.username}` : 'User');
  const profileHref = partner.username ? `/u/${partner.username}` : null;

  const avatar = partner.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={partner.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
  ) : (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-200">
      <UserIcon className="h-6 w-6 text-gray-400" />
    </div>
  );

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
              {profileHref ? <Link href={profileHref}>{avatar}</Link> : avatar}
              <div>
                {profileHref ? (
                  <Link
                    href={profileHref}
                    className="text-base font-semibold text-gray-900 hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="text-base font-semibold text-gray-900">{name}</span>
                )}
                {partner.username && <p className="text-primary-600 text-xs">@{partner.username}</p>}
              </div>
            </div>

            <Thread addr={addr} displayName={name} initialMessages={messages} />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
