import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Bug,
  GitPullRequest,
  LifeBuoy,
  Monitor,
  NotebookPen,
  Presentation,
  Terminal,
  Users,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { useCases } from '@/lib/use-cases';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('useCases.index.meta');
  const title = t('title');
  const description = t('description');
  return {
    title,
    description,
    alternates: { canonical: 'https://pairux.com/use-cases' },
    openGraph: { title, description, url: 'https://pairux.com/use-cases' },
    twitter: { title, description },
  };
}

const icons = [GitPullRequest, Bug, Users, Monitor, LifeBuoy, Presentation];

export default function UseCasesPage() {
  const t = useTranslations('useCases');
  const workflows = useCases.filter(
    (item) => item.slug !== 'agentic-pair-programming' && !item.planned
  );
  return (
    <>
      <Header />
      <main>
        <section className="bg-gray-900 py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
            <div>
              <p className="text-primary-300 font-semibold">{t('index.eyebrow')}</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
                {t('index.title')}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-gray-300">{t('index.intro')}</p>
              <a
                href="#workflows"
                className="mt-8 inline-flex items-center gap-2 font-semibold text-white underline decoration-gray-500 underline-offset-8 hover:decoration-white"
              >
                {t('index.findWorkflow')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
            <Link
              href="/use-cases/agentic-pair-programming"
              className="group rounded-2xl border border-gray-700 bg-gray-800 p-8 transition-colors hover:border-blue-400 sm:p-10"
            >
              <Terminal className="text-primary-300 h-9 w-9" aria-hidden="true" />
              <p className="text-primary-300 mt-8 text-sm font-semibold">
                {t('index.featuredLabel')}
              </p>
              <h2 className="mt-3 text-3xl font-bold">{t('index.featuredTitle')}</h2>
              <p className="mt-4 leading-relaxed text-gray-300">{t('index.featuredBody')}</p>
              <span className="text-primary-300 mt-8 inline-flex items-center gap-2 font-semibold group-hover:text-white">
                {t('index.featuredCta')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </section>

        <section id="workflows" className="scroll-mt-24 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">
              {t('index.workflowsTitle')}
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-gray-600">{t('index.workflowsIntro')}</p>
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {workflows.map((item, index) => {
                const Icon = icons[index] ?? Monitor;
                return (
                  <Link
                    key={item.slug}
                    href={`/use-cases/${item.slug}`}
                    className="group flex flex-col rounded-2xl border border-gray-200 p-7 transition-colors hover:border-blue-400 hover:bg-blue-50/40"
                  >
                    <Icon className="text-primary-600 h-8 w-8" aria-hidden="true" />
                    <p className="mt-6 text-sm font-medium text-gray-500">
                      {t(`items.${item.key}.audience`)}
                    </p>
                    <h3 className="mt-2 text-xl font-bold text-gray-900">
                      {t(`items.${item.key}.title`)}
                    </h3>
                    <p className="mt-4 flex-1 leading-relaxed text-gray-600">
                      {t(`items.${item.key}.description`)}
                    </p>
                    <span className="text-primary-600 mt-6 inline-flex items-center gap-2 font-semibold">
                      {t('exploreWorkflow')}{' '}
                      <ArrowRight
                        className="h-4 w-4 transition-transform group-hover:translate-x-1"
                        aria-hidden="true"
                      />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-blue-50 py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
            <div className="max-w-3xl">
              <p className="text-primary-700 inline-flex items-center gap-2 text-sm font-semibold">
                <NotebookPen className="h-5 w-5" aria-hidden="true" /> {t('index.notesPlans')}
              </p>
              <h2 className="mt-4 text-3xl font-bold text-gray-900">{t('index.notesTitle')}</h2>
              <p className="mt-4 text-lg leading-relaxed text-gray-600">{t('index.notesBody')}</p>
              <p className="mt-3 text-sm text-gray-600">{t('index.notesFootnote')}</p>
            </div>
            <Link
              href="/use-cases/ai-note-taker"
              className="bg-primary-600 hover:bg-primary-700 inline-flex w-fit items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white"
            >
              {t('index.notesCta')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="py-16 text-center sm:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="text-3xl font-bold text-gray-900">{t('index.ctaTitle')}</h2>
            <p className="mt-4 text-lg text-gray-600">{t('index.ctaBody')}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/download"
                className="bg-primary-600 hover:bg-primary-700 rounded-lg px-6 py-3 font-semibold text-white"
              >
                {t('index.getPairux')}
              </Link>
              <Link
                href="/pricing"
                className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-900 hover:bg-gray-50"
              >
                {t('index.comparePlans')}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
