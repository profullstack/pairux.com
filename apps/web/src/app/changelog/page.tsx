import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'See what&apos;s new in PairUX. Release notes and version history.',
};

const releases = [
  {
    version: '0.1.0',
    date: 'January 2025',
    title: 'Initial Release',
    changes: [
      'Screen sharing with remote control',
      'P2P WebRTC connections',
      'Cross-platform desktop apps (macOS, Windows, Linux)',
      'Browser-based viewer (no install required)',
      'End-to-end encryption',
      'Simultaneous input control',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                Changelog
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                See what&apos;s new in PairUX
              </p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="space-y-12">
              {releases.map((release) => (
                <div key={release.version} className="border-primary-500 border-l-2 pl-6">
                  <div className="flex items-center gap-3">
                    <span className="bg-primary-100 text-primary-700 rounded-full px-3 py-1 text-sm font-semibold">
                      v{release.version}
                    </span>
                    <span className="text-sm text-gray-500">{release.date}</span>
                  </div>
                  <h2 className="mt-3 text-xl font-bold text-gray-900">{release.title}</h2>
                  <ul className="mt-4 space-y-2">
                    {release.changes.map((change, i) => (
                      <li key={i} className="text-gray-600">
                        • {change}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
