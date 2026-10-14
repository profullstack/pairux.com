import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DownloadSection } from './download-section';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('download.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/download' },
  };
}

export default function DownloadPage() {
  const t = useTranslations('download');
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
          </div>
        </section>

        <DownloadSection />
      </main>

      <Footer />
    </div>
  );
}
