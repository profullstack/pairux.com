import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { aiNotesContact, useCases } from '@/lib/use-cases';

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return useCases
    .filter((item) => item.slug !== 'agentic-pair-programming')
    .map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = useCases.find((one) => one.slug === slug);
  if (!item) notFound();
  const title = item.planned ? `${item.title} · Planned for Premium Plans` : item.title;
  return {
    title,
    description: item.description,
    alternates: { canonical: `https://pairux.com/use-cases/${slug}` },
    openGraph: {
      title,
      description: item.description,
      url: `https://pairux.com/use-cases/${slug}`,
    },
    twitter: { title, description: item.description },
  };
}

export default async function UseCasePage({ params }: Props) {
  const { slug } = await params;
  const item = useCases.find((one) => one.slug === slug);
  if (!item) notFound();
  const related = useCases.filter((one) => one.slug !== slug && !one.planned).slice(0, 3);
  return (
    <>
      <Header />
      <main>
        <section className="bg-gray-900 py-16 text-white sm:py-24">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <Link
              href="/use-cases"
              className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All use cases
            </Link>
            <p className="text-primary-300 mt-10 font-semibold">{item.audience}</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{item.title}</h1>
            <p className="mt-6 text-xl leading-relaxed text-gray-300">{item.description}</p>
            {item.planned && (
              <p className="mt-6 rounded-xl border border-gray-600 bg-gray-800 p-4 text-gray-200">
                Not available yet. Contact us about premium access and delivery before purchasing
                for this feature.
              </p>
            )}
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-gray-900">When this helps</h2>
            <p className="mt-4 text-lg leading-relaxed text-gray-600">{item.scenario}</p>
            <h2 className="mt-12 text-2xl font-bold text-gray-900">
              {item.planned ? 'The planned workflow' : 'Try this workflow'}
            </h2>
            <ol className="mt-8 space-y-8">
              {item.steps.map((step, index) => (
                <li key={step.title} className="flex gap-5">
                  <span
                    className="bg-primary-100 text-primary-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">{step.title}</h3>
                    <p className="mt-3 leading-relaxed text-gray-600">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-12 rounded-2xl bg-gray-50 p-8">
              <h2 className="text-xl font-bold text-gray-900">
                {item.planned ? 'The goal' : 'What you leave with'}
              </h2>
              <p className="mt-3 leading-relaxed text-gray-600">{item.outcome}</p>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-5">
              {item.planned ? (
                <a
                  href={aiNotesContact}
                  className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white"
                >
                  Discuss premium AI notes <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </a>
              ) : (
                <Link
                  href="/download"
                  className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white"
                >
                  Start with PairUX <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </Link>
              )}
              <Link href="/pricing" className="text-primary-600 font-semibold hover:underline">
                {item.planned ? 'See current plans' : 'Compare plans'}
              </Link>
            </div>
          </div>
        </section>

        <section className="border-t border-gray-200 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-gray-900">More ways to work together</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {related.map((one) => (
                <Link
                  key={one.slug}
                  href={`/use-cases/${one.slug}`}
                  className="rounded-xl border border-gray-200 p-6 hover:border-blue-400"
                >
                  <h3 className="text-lg font-semibold text-gray-900">{one.title}</h3>
                  <p className="mt-3 text-gray-600">{one.description}</p>
                  <span className="text-primary-600 mt-5 inline-flex items-center gap-2 font-semibold">
                    Explore workflow <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
