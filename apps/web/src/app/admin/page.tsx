/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { IntegrationsManager } from './integrations-form';
import { EmailComposer } from './email-composer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.meta');
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

interface Integration {
  id: string;
  name: string;
  kind: string;
  access_token: string;
  request_count: number;
  last_used_at: string | null;
  created_at: string;
}

interface Post {
  id: string;
  slug: string;
  title: string;
  source: string;
  published_at: string;
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const svc = serviceClient();
  const { data: adminRow } = await (svc as any)
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!adminRow) notFound();

  const [{ data: integrationsRaw }, { data: postsRaw }] = await Promise.all([
    (svc as any)
      .from('autoblog_integrations')
      .select('id, name, kind, access_token, request_count, last_used_at, created_at')
      .order('created_at', { ascending: false }),
    (svc as any)
      .from('blog_posts')
      .select('id, slug, title, source, published_at')
      .order('published_at', { ascending: false })
      .limit(20),
  ]);

  const t = await getTranslations('admin');
  const integrations = (integrationsRaw ?? []) as Integration[];
  const posts = (postsRaw ?? []) as Post[];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-12">
        <div className="mx-auto max-w-3xl space-y-10 px-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('loggedInAs', { email: user.email ?? '' })}
            </p>
          </div>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('integrations.title')}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t.rich('integrations.description', {
                  link: (chunks) => (
                    <a href="https://crawlproof.com" className="text-blue-600 underline">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
            <IntegrationsManager initial={integrations as any} />
          </section>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('email.title')}</h2>
              <p className="mt-1 text-sm text-gray-600">{t('email.description')}</p>
            </div>
            <EmailComposer />
          </section>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">{t('posts.title')}</h2>
            {posts.length === 0 ? (
              <p className="text-sm text-gray-500">{t('posts.empty')}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs tracking-wider text-gray-500 uppercase">
                  <tr>
                    <th className="py-2 pr-4">{t('posts.columnTitle')}</th>
                    <th className="py-2 pr-4">{t('posts.columnSource')}</th>
                    <th className="py-2">{t('posts.columnPublished')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {posts.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-4">
                        <Link href={`/blog/${p.slug}`} className="underline hover:text-blue-600">
                          {p.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-gray-500">{p.source}</td>
                      <td className="py-2 text-gray-500">{p.published_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
