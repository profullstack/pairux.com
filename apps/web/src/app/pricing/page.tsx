import type { Metadata } from 'next';
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

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple flat-rate pricing. No per-seat fees. $1/mo for Plus (up to 100 listeners), $12/mo Pro, $49/mo Team. 40-70% cheaper than Zoom, Teams, and other enterprise solutions.',
  alternates: {
    canonical: 'https://pairux.com/pricing',
  },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How many people can watch my room?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Concurrent listeners per room scale with your plan: Free ${String(CAP.free)}, Plus ${String(CAP.plus)}, Pro ${String(CAP.pro)}, Team ${CAP.team.toLocaleString()}. On top of that, public lives can be watched for free by unlimited guests with no account.`,
      },
    },
    {
      '@type': 'Question',
      name: 'Is the free tier really free?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes! 2 participants + up to 20 listeners are completely free, forever — and public lives can be watched for free by unlimited guests with no account. No time limits, no credit card required.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I self-host to avoid costs?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Absolutely. PairUX is open source under the MIT license. You can run your own SFU infrastructure if you prefer.',
      },
    },
    {
      '@type': 'Question',
      name: 'Why are you cheaper than Zoom and Teams?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'We charge per team, not per seat. A 10-person team pays $49/month total with PairUX, vs $220/month with Zoom or Teams.',
      },
    },
  ],
};

const pricingTiers = [
  {
    name: 'Free',
    description: 'Perfect for personal use and small teams',
    price: '$0',
    priceDetail: 'forever',
    features: [
      `2 participants + up to ${String(CAP.free)} listeners`,
      'Unlimited free viewers on public lives',
      'P2P connections',
      'Screen sharing',
      'Remote control',
      'End-to-end encryption',
      'Community support',
    ],
    cta: 'Get Started',
    ctaHref: '/download',
    plan: null,
    highlighted: false,
  },
  {
    name: 'Plus',
    description: 'Host an audience — teaching, standups, watch-alongs',
    price: '$1',
    priceDetail: 'month',
    features: [
      `Up to ${String(CAP.plus)} listeners per room`,
      'SFU relay servers',
      'Public room in the /live directory',
      'Screen sharing + voice',
      'Remote control',
      'Cancel anytime',
    ],
    cta: 'Upgrade to Plus',
    ctaHref: '/signup',
    plan: 'plus' as const,
    highlighted: true,
  },
  {
    name: 'Pro',
    description: 'For professionals and growing teams',
    price: '$12',
    priceDetail: 'month',
    features: [
      `Up to ${String(CAP.pro)} listeners per room`,
      'SFU relay servers',
      'All streaming platforms (YouTube, Twitch, …)',
      'HD screen sharing (1080p)',
      'Public room in the /live directory',
      'Priority support',
    ],
    cta: 'Upgrade to Pro',
    ctaHref: '/signup',
    plan: 'pro' as const,
    highlighted: false,
  },
  {
    name: 'Team',
    description: 'For teams and organizations',
    price: '$49',
    priceDetail: 'month',
    features: [
      `Up to ${CAP.team.toLocaleString()} listeners per room`,
      'Dedicated SFU servers',
      'All streaming platforms',
      '4K screen sharing',
      'Admin controls',
      'Priority support',
    ],
    cta: 'Upgrade to Team',
    ctaHref: '/signup',
    plan: 'team' as const,
    highlighted: false,
  },
];

const comparisonData = [
  {
    plan: 'Free',
    pairux: '$0',
    zoom: '$0 (40 min limit)',
    teams: '$0 (60 min limit)',
  },
  {
    plan: 'Pro / Small Team',
    pairux: '$12/mo',
    zoom: '$16/mo/host',
    teams: '$12.50/mo/user',
  },
  {
    plan: 'Team / Business',
    pairux: '$49/mo',
    zoom: '$22/mo/host',
    teams: '$22/mo/user',
  },
  {
    plan: '10-person team',
    pairux: '$49/mo total',
    zoom: '$220/mo',
    teams: '$220/mo',
  },
];

const competitorComparison = [
  {
    feature: 'Transparent pricing',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'No seat-based fees',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'No annual contracts',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: true,
    jitsi: true,
  },
  {
    feature: 'Simple flat-rate plans',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: true,
    jitsi: true,
  },
  {
    feature: 'Open source',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'Self-hostable',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: true,
  },
  {
    feature: 'Remote control',
    pairux: true,
    zoom: true,
    teams: false,
    webex: true,
    meet: false,
    jitsi: false,
  },
  {
    feature: 'Multi-cursor support',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: false,
    jitsi: false,
  },
  {
    feature: 'No account required (viewers)',
    pairux: true,
    zoom: false,
    teams: false,
    webex: false,
    meet: true,
    jitsi: true,
  },
];

const advantages = [
  {
    icon: DollarSign,
    title: 'No Per-Seat Fees',
    description: 'One price for your whole team. Add users without adding cost.',
  },
  {
    icon: Zap,
    title: 'No Lock-in',
    description: 'No annual contracts or commitments. Cancel anytime.',
  },
  {
    icon: Shield,
    title: 'Open Source',
    description: 'Audit the code, self-host, or customize. Your data, your rules.',
  },
  {
    icon: Users,
    title: 'Developer-Friendly',
    description: 'CLI install, API access, and automation-ready from day one.',
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                40–70% Cheaper Than the Big Guys
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Simple flat-rate pricing. No per-seat fees, no annual contracts, no enterprise sales
                calls.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {pricingTiers.map((tier) => (
                <div
                  key={tier.name}
                  className={`rounded-2xl border-2 bg-white p-8 shadow-sm ${
                    tier.highlighted
                      ? 'border-primary-600 ring-primary-600 ring-2 ring-offset-2'
                      : 'border-gray-200'
                  }`}
                >
                  {tier.highlighted && (
                    <span className="bg-primary-100 text-primary-700 mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold">
                      Most Popular
                    </span>
                  )}
                  <h2 className="text-2xl font-bold text-gray-900">{tier.name}</h2>
                  <p className="mt-2 text-sm text-gray-600">{tier.description}</p>
                  <div className="mt-6">
                    <span className="text-4xl font-bold text-gray-900">{tier.price}</span>
                    <span className="text-gray-600">/{tier.priceDetail}</span>
                  </div>

                  <ul className="mt-8 space-y-4">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-3">
                        <Check className="text-accent-600 h-5 w-5 flex-shrink-0" />
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {tier.plan ? (
                    <div className="mt-8">
                      <UpgradeButton
                        plan={tier.plan}
                        label={tier.cta}
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
                      {tier.cta}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cost Comparison Table */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-gray-900">Real Cost Comparison</h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
              Compare our pricing to typical Zoom Webinars and Microsoft Teams costs
            </p>

            <div className="mt-10 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      Plan
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
                  {comparisonData.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-4 text-sm text-gray-700">{row.plan}</td>
                      <td className="text-primary-600 px-4 py-4 text-sm font-semibold">
                        {row.pairux}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500">{row.zoom}</td>
                      <td className="px-4 py-4 text-sm text-gray-500">{row.teams}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-6 text-center text-sm text-gray-500">
              * PairUX charges per team, not per user. No seat-based licensing.
            </p>
          </div>
        </section>

        {/* Feature Comparison */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold text-gray-900">Feature Comparison</h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
              See how PairUX stacks up against Zoom, Teams, Webex, Google Meet, and Jitsi
            </p>

            <div className="mt-10 overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      Feature
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
                  {competitorComparison.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-3 text-sm text-gray-700">{row.feature}</td>
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
              Why PairUX is Different
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-gray-600">
              Enterprise tools can&apos;t copy this without breaking their pricing models
            </p>

            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {advantages.map((advantage) => (
                <div key={advantage.title} className="rounded-xl bg-white p-6 shadow-sm">
                  <div className="bg-primary-100 flex h-12 w-12 items-center justify-center rounded-lg">
                    <advantage.icon className="text-primary-600 h-6 w-6" />
                  </div>
                  <h3 className="mt-4 font-semibold text-gray-900">{advantage.title}</h3>
                  <p className="mt-2 text-sm text-gray-600">{advantage.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-2xl font-bold text-gray-900">
              Frequently Asked Questions
            </h2>

            <div className="mt-10 space-y-6">
              <div>
                <h3 className="font-semibold text-gray-900">How many people can watch my room?</h3>
                <p className="mt-2 text-gray-600">
                  Concurrent listeners per room scale with your plan: Free {CAP.free}, Plus{' '}
                  {CAP.plus}, Pro {CAP.pro}, Team {CAP.team.toLocaleString()}. On top of that, public
                  lives can be watched for free by unlimited guests with no account.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">Is the free tier really free?</h3>
                <p className="mt-2 text-gray-600">
                  Yes! 2 participants + up to 20 listeners are completely free, forever — and public
                  lives can be watched for free by unlimited guests with no account. No time limits,
                  no credit card required. Great for pair programming and small demos.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">Can I self-host to avoid costs?</h3>
                <p className="mt-2 text-gray-600">
                  Absolutely. PairUX is open source under the MIT license. You can run your own SFU
                  infrastructure if you prefer. Great for enterprises with specific security
                  requirements.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">
                  Why are you cheaper than Zoom and Teams?
                </h3>
                <p className="mt-2 text-gray-600">
                  We charge per team, not per seat. A 10-person team pays $49/month total with
                  PairUX, vs $220/month with Zoom or Teams. No enterprise sales teams means lower
                  overhead for you.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary-600 py-16">
          <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-white">
              Ready to save on video infrastructure?
            </h2>
            <p className="text-primary-100 mx-auto mt-4 max-w-2xl">
              Start free with P2P sessions, or upgrade to Pro for just $12/month. No per-seat fees
              ever.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                href="/download"
                className="text-primary-600 hover:bg-primary-50 rounded-lg bg-white px-8 py-3 font-semibold transition-colors"
              >
                Download Free
              </Link>
              <Link
                href="/signup"
                className="hover:bg-primary-700 rounded-lg border-2 border-white px-8 py-3 font-semibold text-white transition-colors"
              >
                Create Account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
