import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Terminal, Users, Monitor } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('useCases.agentic.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/use-cases/agentic-pair-programming' },
  };
}

const steps = [
  { key: 's0', icon: Terminal },
  { key: 's1', icon: Users },
  { key: 's2', icon: Monitor },
] as const;

export default function AgenticPairProgrammingPage() {
  const t = useTranslations('useCases.agentic');
  return (
    <>
      <Header />
      <main>
        <section className="bg-gray-900 py-24 text-white sm:py-32">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <Link
              href="/use-cases"
              className="mb-8 inline-block text-sm text-gray-300 hover:text-white"
            >
              {t('backLink')}
            </Link>
            <p className="text-primary-300 font-semibold">{t('eyebrow')}</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">{t('title')}</h1>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-gray-300">{t('intro')}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="https://app.moshcode.sh/"
                className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold"
              >
                {t('openMoshcode')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
              <Link
                href="/download"
                className="rounded-lg border border-gray-600 px-6 py-3 font-semibold hover:bg-gray-800"
              >
                {t('getPairux')}
              </Link>
            </div>
          </div>
        </section>
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900">{t('stepsTitle')}</h2>
            <div className="mt-12 grid gap-8 lg:grid-cols-3">
              {steps.map((step, index) => (
                <article key={step.key} className="rounded-2xl border border-gray-200 p-8">
                  <step.icon className="text-primary-600 h-8 w-8" aria-hidden="true" />
                  <h3 className="mt-6 text-xl font-semibold text-gray-900">
                    {t('stepHeading', {
                      number: index + 1,
                      title: t(`steps.${step.key}.title`),
                    })}
                  </h3>
                  <p className="mt-4 leading-relaxed text-gray-600">
                    {t(`steps.${step.key}.body`)}
                  </p>
                </article>
              ))}
            </div>
            <p className="mt-8 max-w-3xl text-gray-600">{t('permissionsNote')}</p>
          </div>
        </section>
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900">{t('contractorTitle')}</h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">{t('contractorP1')}</p>
            <p className="mt-4 text-lg leading-relaxed text-gray-600">{t('contractorP2')}</p>
            <Link
              href="/download"
              className="text-primary-600 hover:text-primary-700 mt-8 inline-flex items-center gap-2 font-semibold"
            >
              {t('startPairing')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
