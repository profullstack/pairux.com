import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clock, CalendarDays, User as UserIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { serviceClient } from '@/lib/supabase/service';
import { findHostByUsername, listActivePages, publicHost, publicPage } from '@/lib/booking';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const [host, t] = await Promise.all([
    findHostByUsername(serviceClient(), username),
    getTranslations('book.meta'),
  ]);
  if (!host) return { title: t('bookCall') };
  const name = host.display_name ?? host.username;
  return {
    title: t('bookCallWith', { name }),
    description: t('hostDescription'),
  };
}

/**
 * /book/<username> — every page a host offers, so a link to the bare username
 * still lands somewhere useful.
 */
export default async function BookHostPage({ params }: PageProps) {
  const { username } = await params;
  const svc = serviceClient();
  const hostRow = await findHostByUsername(svc, username);
  if (!hostRow) notFound();

  const t = await getTranslations('book.host');
  const host = publicHost(hostRow);
  const pages = (await listActivePages(svc, hostRow.id)).map(publicPage);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <div className="mb-8 flex items-center gap-4">
          {host.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={host.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100">
              <UserIcon className="h-8 w-8 text-indigo-600" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{host.displayName}</h1>
            <p className="text-sm text-gray-500">{t('subtitle')}</p>
          </div>
        </div>

        {pages.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
            {t('notTakingBookings', { name: host.displayName })}
          </div>
        ) : (
          <ul className="space-y-3">
            {pages.map((page) => (
              <li key={page.slug}>
                <Link
                  href={`/book/${host.username}/${page.slug}`}
                  className="block rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-semibold text-gray-900">{page.title}</h2>
                      {page.description && (
                        <p className="mt-1 text-sm text-gray-600">{page.description}</p>
                      )}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      <Clock className="h-3.5 w-3.5" />
                      {t('minutes', { minutes: page.durationMinutes })}
                    </span>
                  </div>
                  <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600">
                    <CalendarDays className="h-4 w-4" /> {t('pickTime')}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  );
}
