import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

// Custom GitHub icon SVG component (brand icons deprecated in lucide)
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'PairUX is free and open source. No premium tiers, no feature limits, no strings attached.',
};

const features = [
  'Unlimited screen sharing sessions',
  'Full remote control capabilities',
  'Cross-platform desktop apps',
  'Browser-based viewer (no install)',
  'End-to-end encryption',
  'Simultaneous input control',
  'All future updates',
  'Community support',
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
                Free Forever
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                PairUX is open source software. No premium tiers, no feature
                limits, no strings attached.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing Card */}
        <section className="py-20">
          <div className="mx-auto max-w-lg px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl border-2 border-primary-600 bg-white p-8 shadow-xl">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Open Source</h2>
                <div className="mt-4">
                  <span className="text-5xl font-bold text-gray-900">$0</span>
                  <span className="text-gray-600">/forever</span>
                </div>
                <p className="mt-4 text-gray-600">
                  Everything you need for collaborative screen sharing
                </p>
              </div>

              <ul className="mt-8 space-y-4">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <Check className="h-5 w-5 flex-shrink-0 text-accent-600" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 space-y-3">
                <Link
                  href="/download"
                  className="block w-full rounded-lg bg-primary-600 px-4 py-3 text-center font-semibold text-white transition-colors hover:bg-primary-700"
                >
                  Download Now
                </Link>
                <Link
                  href="https://github.com/pairux/pairux"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-900 transition-colors hover:bg-gray-50"
                >
                  <GitHubIcon className="h-5 w-5" />
                  View Source Code
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-gray-50 py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-center text-2xl font-bold text-gray-900">
              Frequently Asked Questions
            </h2>

            <div className="mt-10 space-y-6">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Why is PairUX free?
                </h3>
                <p className="mt-2 text-gray-600">
                  We believe collaborative tools should be accessible to
                  everyone. PairUX is open source under the MIT license, funded
                  by community contributions and sponsored by companies who use
                  it.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">
                  Will there ever be a paid version?
                </h3>
                <p className="mt-2 text-gray-600">
                  The core product will always be free. We may offer optional
                  managed services (like TURN servers) for teams who want a
                  turnkey solution, but all features will remain in the open
                  source version.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">
                  How can I support the project?
                </h3>
                <p className="mt-2 text-gray-600">
                  You can support PairUX by contributing code, reporting bugs,
                  improving documentation, or sponsoring the project on GitHub.
                  Every contribution helps!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900">
                  Can I use PairUX for my business?
                </h3>
                <p className="mt-2 text-gray-600">
                  Yes! PairUX is MIT licensed, which means you can use it for
                  personal, commercial, and enterprise purposes without any
                  restrictions.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
