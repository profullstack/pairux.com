import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about PairUX - the open source collaborative screen sharing tool.',
};

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                About PairUX
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Building the collaborative tools we wish existed
              </p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="prose prose-lg max-w-none">
              <h2>Our Mission</h2>
              <p>
                PairUX was born from frustration. After Slack acquired Screenhero and shut it down,
                remote pair programming became unnecessarily difficult. Existing tools either lack
                remote control, require expensive licenses, or force you into vendor lock-in.
              </p>
              <p>
                We believe collaborative screen sharing should be accessible to everyone.
                That&apos;s why PairUX is open source, with transparent pricing and no artificial
                limitations.
              </p>

              <h2>What We&apos;re Building</h2>
              <p>
                PairUX is a desktop application for collaborative screen sharing with simultaneous
                remote control. Think Screenhero, but modern, open source, and cross-platform.
              </p>
              <ul>
                <li>Real-time screen sharing with low latency</li>
                <li>Multiple participants can control the shared screen simultaneously</li>
                <li>End-to-end encryption for security</li>
                <li>Works across macOS, Windows, and Linux</li>
                <li>Viewers can join from any browser</li>
              </ul>

              <h2>Open Source</h2>
              <p>
                PairUX is released under the MIT license. You can view, modify, and contribute to
                the code on{' '}
                <Link
                  href="https://github.com/profullstack/pairux.com"
                  className="text-primary-600 hover:underline"
                >
                  GitHub
                </Link>
                . We welcome contributions from the community.
              </p>

              <h2>Contact</h2>
              <p>
                Have questions or feedback? Reach out to us at{' '}
                <Link href="mailto:hello@pairux.com" className="text-primary-600 hover:underline">
                  hello@pairux.com
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
