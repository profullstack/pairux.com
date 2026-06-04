import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { loadAllPosts } from '@/lib/blog/posts';

export const metadata: Metadata = {
  title: 'Blog - PairUX',
  description: 'News, updates, and tutorials from the PairUX team.',
  alternates: {
    canonical: 'https://pairux.com/blog',
    types: { 'application/rss+xml': 'https://pairux.com/blog/rss.xml' },
  },
};

export const revalidate = 60;

export default async function BlogPage() {
  const posts = await loadAllPosts();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">Blog</h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                News, updates, and tutorials from the PairUX team
              </p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            {posts.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-12 text-center">
                <h2 className="text-xl font-semibold text-gray-900">Coming Soon</h2>
                <p className="mt-2 text-gray-600">
                  We&apos;re working on our first blog posts. Check back soon for tutorials, product
                  updates, and behind-the-scenes looks at building PairUX.
                </p>
              </div>
            ) : (
              <ul className="space-y-6">
                {posts.map((p) => (
                  <li
                    key={p.slug}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                  >
                    <Link
                      href={`/blog/${p.slug}`}
                      className="flex gap-4 p-5 transition-colors hover:bg-gray-50"
                    >
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt=""
                          loading="lazy"
                          width={112}
                          height={112}
                          className="h-24 w-24 shrink-0 rounded-lg object-cover sm:h-28 sm:w-28"
                        />
                      ) : (
                        <div
                          aria-hidden
                          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold tracking-widest text-gray-400 uppercase sm:h-28 sm:w-28"
                        >
                          PX
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg leading-snug font-semibold text-gray-900 sm:text-xl">
                          {p.title}
                        </h2>
                        <p className="mt-1 text-xs text-gray-500">{p.date}</p>
                        {p.excerpt && (
                          <p className="mt-2 line-clamp-2 text-sm text-gray-600">{p.excerpt}</p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
