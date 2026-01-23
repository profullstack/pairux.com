import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, X, Zap, Shield, Users, DollarSign } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple flat-rate pricing. No per-seat fees. $12/mo for Pro, $49/mo for Team. 40-70% cheaper than Zoom, Teams, and other enterprise solutions.',
};

const pricingTiers = [
  {
    name: 'Free',
    description: 'Perfect for personal use and small teams',
    price: '$0',
    priceDetail: 'forever',
    features: [
      '2 participants + 5 viewers',
      'P2P connections',
      'Screen sharing',
      'Remote control',
      'End-to-end encryption',
      'Community support',
    ],
    cta: 'Get Started',
    ctaHref: '/download',
    highlighted: false,
  },
  {
    name: 'Pro',
    description: 'For professionals and growing teams',
    price: '$12',
    priceDetail: 'month',
    features: [
      '10 participants + 50 viewers',
      '100 viewer-hours/month included',
      'Overage: $0.08/hr (720p), $0.12/hr (1080p)',
      'SFU relay servers',
      'HD screen sharing (1080p)',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    ctaHref: '/signup',
    highlighted: true,
  },
  {
    name: 'Team',
    description: 'For teams and organizations',
    price: '$49',
    priceDetail: 'month',
    features: [
      'Unlimited participants',
      '500 viewer-hours/month included',
      'Overage: $0.08 / $0.12 / $0.20 (4K)',
      'Dedicated SFU servers',
      '4K screen sharing',
      'Admin controls',
    ],
    cta: 'Start Free Trial',
    ctaHref: '/signup',
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
            <div className="grid gap-8 lg:grid-cols-3">
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
                <h3 className="font-semibold text-gray-900">
                  What&apos;s included in viewer-hours?
                </h3>
                <p className="mt-2 text-gray-600">
                  Viewer-hours measure the total time viewers spend watching your streams via our
                  SFU relay servers. Pro includes 100 hours/month, Team includes 500 hours/month.
                  Most users never exceed their allotment.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">
                  What happens if I exceed my viewer-hours?
                </h3>
                <p className="mt-2 text-gray-600">
                  We&apos;ll notify you when you&apos;re approaching your limit. Additional hours
                  are billed at $0.08/hr (720p), $0.12/hr (1080p), or $0.20/hr (4K). We&apos;ll
                  never cut off your stream mid-session.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">Is the free tier really free?</h3>
                <p className="mt-2 text-gray-600">
                  Yes! P2P connections between 2 participants + up to 5 viewers are completely free,
                  forever. No time limits, no credit card required. Great for pair programming and
                  small demos.
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
