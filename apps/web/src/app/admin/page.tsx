/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { IntegrationsManager } from './integrations-form';
import { EmailComposer } from './email-composer';

export const metadata: Metadata = {
  title: 'Admin - PairUX',
  robots: { index: false, follow: false },
};

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

  const integrations = (integrationsRaw ?? []) as Integration[];
  const posts = (postsRaw ?? []) as Post[];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-12">
        <div className="mx-auto max-w-3xl space-y-10 px-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin</h1>
            <p className="mt-1 text-sm text-gray-500">Logged in as {user.email}</p>
          </div>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Autoblog integrations</h2>
              <p className="mt-1 text-sm text-gray-600">
                Generate a bearer token, then paste it into{' '}
                <a href="https://crawlproof.com" className="text-blue-600 underline">
                  CrawlProof
                </a>{' '}
                as the webhook secret. The token doubles as the HMAC signing secret for request
                verification.
              </p>
            </div>
            <IntegrationsManager initial={integrations as any} />
          </section>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Email users</h2>
              <p className="mt-1 text-sm text-gray-600">
                Compose an HTML email and send it to all registered users via Resend.
              </p>
            </div>
            <EmailComposer />
          </section>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Recent blog posts</h2>
            {posts.length === 0 ? (
              <p className="text-sm text-gray-500">No posts ingested yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs tracking-wider text-gray-500 uppercase">
                  <tr>
                    <th className="py-2 pr-4">Title</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2">Published</th>
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
