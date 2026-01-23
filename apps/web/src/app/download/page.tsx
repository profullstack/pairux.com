import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DownloadSection } from './download-section';

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Download PairUX for macOS, Windows, or Linux. Available via Homebrew, WinGet, APT, and direct download.',
};

export default function DownloadPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                Download PairUX
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Get the desktop app to host sessions. Viewers can join from any browser.
              </p>
            </div>
          </div>
        </section>

        <DownloadSection />
      </main>

      <Footer />
    </div>
  );
}
