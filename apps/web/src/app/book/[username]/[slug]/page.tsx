import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { serviceClient } from '@/lib/supabase/service';
import { findActivePage, findHostByUsername, publicHost, publicPage } from '@/lib/booking';
import { BookingClient } from './BookingClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ username: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username, slug } = await params;
  const svc = serviceClient();
  const host = await findHostByUsername(svc, username);
  const page = host ? await findActivePage(svc, host.id, slug) : null;
  if (!host || !page) return { title: 'Book a call · PairUX' };
  const name = host.display_name ?? host.username;
  return {
    title: `${page.title} with ${name} · PairUX`,
    description:
      page.description ??
      `Book ${String(page.duration_minutes)} minutes with ${name}. The call happens in PairUX.`,
  };
}

/** /book/<username>/<slug> — pick a time, leave a name, done. */
export default async function BookSlotPage({ params }: PageProps) {
  const { username, slug } = await params;
  const svc = serviceClient();
  const hostRow = await findHostByUsername(svc, username);
  if (!hostRow) notFound();
  const pageRow = await findActivePage(svc, hostRow.id, slug);
  if (!pageRow) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <BookingClient host={publicHost(hostRow)} page={publicPage(pageRow)} />
      </main>
      <Footer />
    </div>
  );
}
