import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Monitor,
  MousePointer2,
  Users,
  Lock,
  Globe,
  Cpu,
  ArrowRight,
  Video,
  Keyboard,
  Wifi,
  Eye,
  Pointer,
  Shield,
  Check,
  MessageSquare,
  Sparkles,
  CircleDot,
} from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('features.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/features' },
  };
}

/**
 * A screenshot is only attached where the shipped product actually shows the
 * feature. Remote control lives in the desktop app, so those entries keep the
 * illustrated placeholder rather than borrowing an unrelated screen.
 */
type FeatureKey =
  | 'callAnalysis'
  | 'screenSharing'
  | 'remoteControl'
  | 'simultaneousInput'
  | 'consent'
  | 'pwaViewer'
  | 'crossPlatform'
  | 'recording'
  | 'textChat';
type ImageKey = 'screenSharing' | 'consent' | 'pwaViewer' | 'crossPlatform' | 'recording';

/** Bullet keys under features.main.<key>.details. */
const DETAIL_KEYS = ['d0', 'd1', 'd2', 'd3'] as const;

interface Feature {
  /** Message key under features.main.* (title, description, details). */
  key: FeatureKey;
  icon: LucideIcon;
  comingSoon?: boolean;
  /** Screenshot; its alt text is features.imageAlts.<alt>. */
  image?: { src: string; alt: ImageKey };
}

const mainFeatures: Feature[] = [
  { key: 'callAnalysis', icon: Sparkles },
  {
    key: 'screenSharing',
    icon: Monitor,
    image: { src: '/screenshots/screen-sharing.png', alt: 'screenSharing' },
  },
  { key: 'remoteControl', icon: MousePointer2 },
  { key: 'simultaneousInput', icon: Users },
  { key: 'consent', icon: Lock, image: { src: '/screenshots/consent-model.png', alt: 'consent' } },
  {
    key: 'pwaViewer',
    icon: Globe,
    image: { src: '/screenshots/pwa-viewer.png', alt: 'pwaViewer' },
  },
  {
    key: 'crossPlatform',
    icon: Cpu,
    image: { src: '/screenshots/cross-platform.png', alt: 'crossPlatform' },
  },
  {
    key: 'recording',
    icon: CircleDot,
    comingSoon: true,
    image: { src: '/screenshots/screen-recording.png', alt: 'recording' },
  },
  { key: 'textChat', icon: MessageSquare, comingSoon: true },
];

const technicalFeatures = [
  { key: 'p2p', icon: Video },
  { key: 'e2e', icon: Shield },
  { key: 'nat', icon: Wifi },
  { key: 'adaptive', icon: Eye },
  { key: 'sharedControl', icon: Pointer },
  { key: 'keyboard', icon: Keyboard },
] as const;

// Cells that are strings are keys under features.compare.values.*
const comparisonFeatures = [
  { key: 'screenSharing', pairux: true, others: true },
  { key: 'remoteControl', pairux: true, others: true },
  { key: 'simultaneousControl', pairux: true, others: false },
  { key: 'localRecording', pairux: 'soon', others: 'partial' },
  { key: 'textChat', pairux: 'soon', others: true },
  { key: 'noAccount', pairux: true, others: false },
  { key: 'openSource', pairux: true, others: false },
  { key: 'selfHostable', pairux: true, others: false },
  { key: 'e2e', pairux: true, others: 'partial' },
  { key: 'nativeApps', pairux: true, others: true },
  { key: 'browserViewer', pairux: true, others: false },
  { key: 'freeTier', pairux: 'unlimited', others: 'limited' },
] as const;

export default function FeaturesPage() {
  const t = useTranslations('features');
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                {t('hero.title')}
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{t('hero.subtitle')}</p>
            </div>

            <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-2xl border border-gray-200 shadow-lg">
              <Image
                src="/screenshots/dashboard.png"
                alt={t('hero.imageAlt')}
                width={2880}
                height={1620}
                priority
                sizes="(min-width: 1024px) 64rem, 100vw"
                className="w-full"
              />
            </div>
          </div>
        </section>

        {/* Main Features */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="space-y-20">
              {mainFeatures.map((feature, index) => (
                <div
                  key={feature.key}
                  className={`grid items-center gap-12 lg:grid-cols-2 ${
                    index % 2 === 1 ? 'lg:flex-row-reverse' : ''
                  }`}
                >
                  <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                    <div className="flex items-center gap-4">
                      <div className="bg-primary-100 text-primary-600 flex h-14 w-14 items-center justify-center rounded-xl">
                        <feature.icon className="h-7 w-7" />
                      </div>
                      {feature.comingSoon && (
                        <span className="bg-accent-100 text-accent-700 rounded-full px-3 py-1 text-xs font-medium">
                          {t('comingSoon')}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-6 text-3xl font-bold text-gray-900">
                      {t(`main.${feature.key}.title`)}
                    </h2>
                    <p className="mt-4 text-lg text-gray-600">
                      {t(`main.${feature.key}.description`)}
                    </p>
                    <ul className="mt-6 space-y-3">
                      {DETAIL_KEYS.map((detail) => (
                        <li key={detail} className="flex items-center gap-3">
                          <Check className="text-accent-600 h-5 w-5" />
                          <span className="text-gray-700">
                            {t(`main.${feature.key}.details.${detail}`)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {feature.image ? (
                    <div
                      className={`aspect-video overflow-hidden rounded-2xl border border-gray-200 shadow-sm ${
                        index % 2 === 1 ? 'lg:order-1' : ''
                      }`}
                    >
                      <Image
                        src={feature.image.src}
                        alt={t(`imageAlts.${feature.image.alt}`)}
                        width={2880}
                        height={1620}
                        sizes="(min-width: 1024px) 50vw, 100vw"
                        className="h-full w-full object-cover object-top"
                      />
                    </div>
                  ) : (
                    <div
                      className={`from-primary-100 to-accent-100 aspect-video rounded-2xl bg-gradient-to-br ${
                        index % 2 === 1 ? 'lg:order-1' : ''
                      }`}
                    >
                      <div className="flex h-full items-center justify-center">
                        <feature.icon className="text-primary-400/50 h-24 w-24" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technical Features Grid */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900">{t('tech.title')}</h2>
              <p className="mx-auto mt-4 max-w-2xl text-gray-600">{t('tech.subtitle')}</p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {technicalFeatures.map((feature) => (
                <div key={feature.key} className="rounded-xl border border-gray-200 bg-white p-6">
                  <feature.icon className="text-primary-600 h-8 w-8" />
                  <h3 className="mt-4 font-semibold text-gray-900">
                    {t(`technical.${feature.key}.title`)}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {t(`technical.${feature.key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison Table */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900">{t('compare.title')}</h2>
              <p className="mx-auto mt-4 max-w-2xl text-gray-600">{t('compare.subtitle')}</p>
            </div>

            <div className="mt-12 overflow-x-auto">
              <table className="w-full min-w-[500px] border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-4 pr-4 text-left font-semibold text-gray-900">
                      {t('compare.feature')}
                    </th>
                    <th className="text-primary-600 px-4 py-4 text-center font-semibold">PairUX</th>
                    <th className="px-4 py-4 text-center font-semibold text-gray-500">
                      {t('compare.others')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((row) => (
                    <tr key={row.key} className="border-b border-gray-100">
                      <td className="py-4 pr-4 text-gray-700">{t(`compare.rows.${row.key}`)}</td>
                      <td className="px-4 py-4 text-center">
                        {row.pairux === true ? (
                          <Check className="text-accent-600 mx-auto h-5 w-5" />
                        ) : (
                          <span className="text-accent-600 text-sm font-medium">
                            {t(`compare.values.${row.pairux}`)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {row.others === true ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : row.others === false ? (
                          <span className="text-gray-300">-</span>
                        ) : (
                          <span className="text-sm text-gray-500">
                            {t(`compare.values.${row.others}`)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary-600 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
              <div className="text-center sm:text-left">
                <h2 className="text-2xl font-bold text-white">{t('cta.title')}</h2>
                <p className="text-primary-100 mt-1">{t('cta.subtitle')}</p>
              </div>
              <Link
                href="/download"
                className="text-primary-600 hover:bg-primary-50 flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold transition-colors"
              >
                {t('cta.button')}
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
