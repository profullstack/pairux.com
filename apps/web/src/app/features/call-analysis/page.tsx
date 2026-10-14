import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  BarChart3,
  Mic,
  Presentation,
  ShieldCheck,
  Sparkles,
  Users,
  UserCheck,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('features.callAnalysisPage.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/features/call-analysis' },
  };
}

const kinds = [
  { key: 'interviews', icon: UserCheck },
  { key: 'teamSyncs', icon: Users },
  { key: 'presentations', icon: Presentation },
] as const;

const MEASURED = ['m0', 'm1', 'm2', 'm3'] as const;
const HOW_STEPS = ['s0', 's1', 's2'] as const;
const PRIVACY_POINTS = ['p0', 'p1', 'p2', 'p3', 'p4'] as const;

export default function CallAnalysisFeaturePage() {
  const t = useTranslations('features.callAnalysisPage');
  return (
    <>
      <Header />
      <main>
        <section className="bg-gradient-to-br from-violet-800 to-indigo-900 py-24 text-white sm:py-32">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="flex items-center gap-2 font-semibold text-violet-200">
              <Sparkles className="h-5 w-5" aria-hidden="true" /> {t('eyebrow')}
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">{t('title')}</h1>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-violet-100">{t('intro')}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/host"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-violet-800 hover:bg-violet-50"
              >
                {t('startCta')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <Link
                href="/pricing"
                className="rounded-lg border border-violet-300 px-6 py-3 font-semibold hover:bg-white/10"
              >
                {t('seePlans')}
              </Link>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900">{t('kindsTitle')}</h2>
            <div className="mt-10 grid gap-8 lg:grid-cols-3">
              {kinds.map((k) => (
                <article key={k.key} className="rounded-2xl border border-gray-200 p-8">
                  <k.icon className="h-8 w-8 text-violet-600" aria-hidden="true" />
                  <h3 className="mt-5 text-xl font-semibold text-gray-900">
                    {t(`kinds.${k.key}.title`)}
                  </h3>
                  <p className="mt-3 leading-relaxed text-gray-600">{t(`kinds.${k.key}.body`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-gray-50 py-20">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <BarChart3 className="h-6 w-6 text-violet-600" aria-hidden="true" />{' '}
                {t('measuredTitle')}
              </h2>
              <p className="mt-4 text-gray-600">{t('measuredBody')}</p>
              <ul className="mt-6 list-disc space-y-2 pl-6 text-gray-700">
                {MEASURED.map((m) => (
                  <li key={m}>{t(`measured.${m}`)}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <Mic className="h-6 w-6 text-violet-600" aria-hidden="true" /> {t('howTitle')}
              </h2>
              <ol className="mt-4 list-decimal space-y-3 pl-6 text-gray-700">
                {HOW_STEPS.map((step) => (
                  <li key={step}>
                    {t.rich(`how.${step}`, { strong: (chunks) => <strong>{chunks}</strong> })}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ShieldCheck className="h-6 w-6 text-violet-600" aria-hidden="true" />{' '}
              {t('privacyTitle')}
            </h2>
            <ul className="mt-6 list-disc space-y-2 pl-6 text-gray-700">
              {PRIVACY_POINTS.map((point) => (
                <li key={point}>{t(`privacy.${point}`)}</li>
              ))}
            </ul>
            <Link
              href="/host"
              className="mt-10 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-700"
            >
              {t('tryCta')} <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
