import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Check, X, Zap, Shield, Users, DollarSign } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { UpgradeButton } from './UpgradeButton';
import { maxListeners } from '@pairux/shared-types';

// Listener capacity per tier — single source of truth (LISTENER_CAP), so the
// pricing copy always ascends and can't drift out of sync with enforcement.
const CAP = {
  free: maxListeners('free'),
  plus: maxListeners('plus'),
  pro: maxListeners('pro'),
  team: maxListeners('team'),
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pricing.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: 'https://pairux.com/pricing',
    },
  };
}

const FAQ_KEYS = ['capacity', 'free', 'selfHost', 'cheaper'] as const;

// Copy for each tier lives under pricing.tiers.<key>; feature lists are
// pricing.tiers.<key>.features.<featureKey>.
interface PricingTier {
  key: 'free' | 'plus' | 'pro' | 'team';
  price: number;
  period: 'forever' | 'month';
  features: readonly string[];
  ctaHref: string;
  plan: 'plus' | 'pro' | 'team' | null;
  highlighted: boolean;
}

const pricingTiers: PricingTier[] = [
  {
    key: 'free',
    price: 0,
    period: 'forever',
    features: [
      'participants',
      'publicViewers',
      'p2p',
      'screenSharing',
      'remoteControl',
      'e2e',
      'support',
    ],
    ctaHref: '/download',
    plan: null,
    highlighted: false,
  },
  {
    key: 'plus',
    price: 1,
    period: 'month',
    features: ['listeners', 'sfu', 'liveDirectory', 'screenVoice', 'remoteControl', 'cancel'],
    ctaHref: '/signup',
    plan: 'plus',
    highlighted: true,
  },
  {
    key: 'pro',
    price: 12,
    period: 'month',
    features: ['listeners', 'sfu', 'streaming', 'hd', 'liveDirectory', 'callAnalysis', 'support'],
    ctaHref: '/signup',
    plan: 'pro',
    highlighted: false,
  },
  {
    key: 'team',
    price: 49,
    period: 'month',
    features: ['listeners', 'sfu', 'streaming', 'uhd', 'callAnalysis', 'admin', 'support'],
    ctaHref: '/signup',
    plan: 'team',
    highlighted: false,
  },
];

// Prices are formatted with the active locale and slotted into pricing.cost.* copy.
const comparisonData = [
  {
    key: 'free',
    pairux: { price: 0 },
    zoom: { msg: 'freeLimit', price: 0, minutes: 40 },
    teams: { msg: 'freeLimit', price: 0, minutes: 60 },
  },
  {
    key: 'pro',
    pairux: { msg: 'perMonth', price: 12 },
    zoom: { msg: 'perHost', price: 16 },
    teams: { msg: 'perUser', price: 12.5 },
  },
  {
    key: 'team',
    pairux: { msg: 'perMonth', price: 49 },
    zoom: { msg: 'perHost', price: 22 },
    teams: { msg: 'perUser', price: 22 },
  },
  {
    key: 'tenPerson',
    pairux: { msg: 'perMonthTotal', price: 49 },
    zoom: { msg: 'perMonth', price: 220 },
    teams: { msg: 'perMonth', price: 220 },
  },
] as const;

const competitorComparison = [
  {
    feature: 'transparent',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'noSeatFees',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'noContracts',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: true,
    jitsi: true,
  },
  {
    feature: 'flatRate',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: true,
    jitsi: true,
  },
  {
    feature: 'openSource',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'selfHost',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'remoteControl',
    pairux: true,
    zoom: true,
    teams: false,
    webex: true,
    meet: false,
    jitsi: false,
  },
  {
    feature: 'multiCursor',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: false,
  },
  {
    feature: 'noAccount',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: true,
    jitsi: true,
  },
];

const advantages = [
  { icon: DollarSign, key: 'noSeatFees' },
  { icon: Zap, key: 'noLockIn' },
  { icon: Shield, key: 'openSource' },
  { icon: Users, key: 'developer' },
] as const;

export default async function PricingPage() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const [t, format] = await Promise.all([getTranslations('pricing'), getFormatter()]);
  const usd = (amount: number) =>
    format.number(amount, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  const caps = {
    free: format.number(CAP.free),
    plus: format.number(CAP.plus),
    pro: format.number(CAP.pro),
    team: format.number(CAP.team),
  };
  const priceCell = (cell: {
    msg?: 'freeLimit' | 'perMonth' | 'perHost' | 'perUser' | 'perMonthTotal';
    price: number;
    minutes?: number;
  }) =>
    cell.msg
      ? t(`cost.cells.${cell.msg}`, { price: usd(cell.price), minutes: cell.minutes ?? 0 })
      : usd(cell.price);
  const faqValues = { ...caps, freeCap: caps.free, teamPrice: usd(49), competitorPrice: usd(220) };
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_KEYS.map((key) => ({
      '@type': 'Question',
      name: t(`faq.${key}.question`),
      acceptedAnswer: { '@type': 'Answer', text: t(`faq.${key}.answer`, faqValues) },
    })),
  };
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
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
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {pricingTiers.map((tier) => (
                <div
                  key={tier.key}
                  className={`rounded-2xl border-2 bg-white p-8 shadow-sm ${
                    tier.highlighted
                      ? 'border-primary-600 ring-primary-600 ring-2 ring-offset-2'
                      : 'border-gray-200'
                  }`}
                >
                  {tier.highlighted && (
                    <span className="bg-primary-100 text-primary-700 mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold">
                      {t('mostPopular')}
                    </span>
                  )}
                  <h2 className="text-2xl font-bold text-gray-900">
                    {t(`tiers.${tier.key}.name`)}
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">{t(`tiers.${tier.key}.description`)}</p>
                  <div className="mt-6">
                    <span className="text-4xl font-bold text-gray-900">{usd(tier.price)}</span>
                    <span className="text-gray-600">{t(`period.${tier.period}`)}</span>
                  </div>

                  <ul className="mt-8 space-y-4">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3">
                        <Check className="text-accent-600 h-5 w-5 flex-shrink-0" />
                        <span className="text-gray-700">
                          {t(`tiers.${tier.key}.features.${feature}`, { count: caps[tier.key] })}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {tier.plan ? (
                    <div className="mt-8">
                      <UpgradeButton
                        plan={tier.plan}
                        label={t(`tiers.${tier.key}.cta`)}
                        className={`block w-full rounded-lg px-4 py-3 text-center font-semibold transition-colors ${
                          tier.highlighted
                            ? 'bg-primary-600 hover:bg-primary-700 text-white'
                            : 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
                        }`}
                      />
                    </div>
                  ) : (
                    <Link
                      href={tier.ctaHref}
                      className={`mt-8 block w-full rounded-lg px-4 py-3 text-center font-semibold transition-colors ${
                        tier.highlighted
                          ? 'bg-primary-600 hover:bg-primary-700 text-white'
                          : 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {t(`tiers.${tier.key}.cta`)}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-blue-100 bg-blue-50 py-12">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-primary-700 text-sm font-semibold">{t('callAnalysis.eyebrow')}</p>
            <h2 className="mt-3 text-2xl font-bold text-gray-900">{t('callAnalysis.title')}</h2>
            <p className="mt-4 leading-relaxed text-gray-600">{t('callAnalysis.description')}</p>
            <Link
              href="/features/call-analysis"
              className="text-primary-600 mt-5 inline-block font-semibold hover:underline"
            >
              {t('callAnalysis.cta')}
            </Link>
          </div>
        </section>

        {/* Cost Comparison Table */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-gray-900">{t('cost.title')}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">{t('cost.subtitle')}</p>

            <div className="mt-10 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      {t('cost.plan')}
                    </th>
                    <th className="text-primary-600 px-4 py-3 text-left text-sm font-semibold">
                      PairUX
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500">
                      Zoom
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-500">
                      Teams
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row) => (
                    <tr key={row.key} className="border-b border-gray-100">
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {t(`cost.rows.${row.key}`)}
                      </td>
                      <td className="text-primary-600 px-4 py-4 text-sm font-semibold">
                        {priceCell(row.pairux)}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500">{priceCell(row.zoom)}</td>
                      <td className="px-4 py-4 text-sm text-gray-500">{priceCell(row.teams)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-6 text-center text-sm text-gray-500">{t('cost.footnote')}</p>
          </div>
        </section>

        {/* Feature Comparison */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-gray-900">
              {t('comparison.title')}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
              {t('comparison.subtitle')}
            </p>

            <div className="mt-10 overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      {t('comparison.feature')}
                    </th>
                    <th className="text-primary-600 px-4 py-3 text-center text-sm font-semibold">
                      PairUX
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-500">
                      Zoom
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-500">
                      Teams
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-500">
                      Webex
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-500">
                      Meet
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-500">
                      Jitsi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {competitorComparison.map((row) => (
                    <tr key={row.feature} className="border-b border-gray-100">
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {t(`comparison.rows.${row.feature}`)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.pairux ? (
                          <Check className="text-accent-600 mx-auto h-5 w-5" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.zoom ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.teams ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.webex ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.meet ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.jitsi ? (
                          <Check className="mx-auto h-5 w-5 text-gray-400" />
                        ) : (
                          <X className="mx-auto h-5 w-5 text-gray-300" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Why We're Different */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-gray-900">
              {t('advantages.title')}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
              {t('advantages.subtitle')}
            </p>

            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {advantages.map((advantage) => (
                <div key={advantage.key} className="rounded-xl bg-white p-6 shadow-sm">
                  <div className="bg-primary-100 flex h-12 w-12 items-center justify-center rounded-lg">
                    <advantage.icon className="text-primary-600 h-6 w-6" />
                  </div>
                  <h3 className="mt-4 font-semibold text-gray-900">
                    {t(`advantages.items.${advantage.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    {t(`advantages.items.${advantage.key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-2xl font-bold text-gray-900">{t('faq.title')}</h2>

            <div className="mt-10 space-y-6">
              {FAQ_KEYS.map((key) => (
                <div key={key}>
                  <h3 className="font-semibold text-gray-900">{t(`faq.${key}.question`)}</h3>
                  <p className="mt-2 text-gray-600">{t(`faq.${key}.answerLong`, faqValues)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary-600 py-16">
          <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-white">{t('cta.title')}</h2>
            <p className="text-primary-100 mx-auto mt-4 max-w-2xl">
              {t('cta.subtitle', { price: usd(12) })}
            </p>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                href="/download"
                className="text-primary-600 hover:bg-primary-50 rounded-lg bg-white px-8 py-3 font-semibold transition-colors"
              >
                {t('cta.download')}
              </Link>
              <Link
                href="/signup"
                className="hover:bg-primary-700 rounded-lg border-2 border-white px-8 py-3 font-semibold text-white transition-colors"
              >
                {t('cta.signup')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
