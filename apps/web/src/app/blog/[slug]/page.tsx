import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { findPost } from '@/lib/blog/posts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) return { title: 'Post not found' };
  return {
    title: `${post.title} - PairUX Blog`,
    description: post.excerpt || undefined,
    alternates: { canonical: `https://pairux.com/blog/${slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.excerpt || undefined,
      images: post.image_url ? [{ url: post.image_url }] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) notFound();
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 py-12">
        <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <Link
            href="/blog"
            className="mb-8 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            ← Back to blog
          </Link>
          <script
            type="application/ld+json"
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'BlogPosting',
                headline: post.title,
                datePublished: post.date,
                author: { '@type': 'Organization', name: 'PairUX' },
                mainEntityOfPage: `https://pairux.com/blog/${post.slug}`,
                ...(post.image_url ? { image: [post.image_url] } : {}),
              }),
            }}
          />
          <p className="mt-4 text-sm text-gray-500">{post.date}</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-gray-900">{post.title}</h1>
          {post.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.image_url}
              alt=""
              className="mt-8 w-full rounded-2xl border border-gray-200"
            />
          )}
          {post.html ? (
            <div
              className="prose prose-gray mt-8 max-w-none"
              dangerouslySetInnerHTML={{ __html: post.html }}
            />
          ) : (
            <div className="mt-8 text-lg leading-relaxed text-gray-700">
              <p>{post.excerpt}</p>
            </div>
          )}
        </article>
      </main>

      <Footer />
    </div>
  );
}
