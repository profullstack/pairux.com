import { buildRssXml } from '@profullstack/autoblog/feeds';
import { loadAllPosts } from '@/lib/blog/posts';

export const revalidate = 60;

export async function GET() {
  const posts = await loadAllPosts();

  const xml = buildRssXml({
    title: 'PairUX Blog',
    description: 'News, updates, and tutorials from the PairUX team.',
    siteUrl: 'https://pairux.com',
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      publishedAt: p.date,
      excerpt: p.excerpt,
      html: p.html ?? null,
      imageUrl: p.image_url ?? null,
    })),
  });

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=60',
    },
  });
}
