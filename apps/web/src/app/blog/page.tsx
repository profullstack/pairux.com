import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'News, updates, and tutorials from the PairUX team.',
};

export default function BlogPage() {
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
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-12 text-center">
              <h2 className="text-xl font-semibold text-gray-900">Coming Soon</h2>
              <p className="mt-2 text-gray-600">
                We&apos;re working on our first blog posts. Check back soon for tutorials, product
                updates, and behind-the-scenes looks at building PairUX.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
