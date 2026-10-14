import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('about.meta');
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: 'https://pairux.com/about' },
  };
}

const BUILDING_POINTS = ['b0', 'b1', 'b2', 'b3', 'b4'] as const;

export default function AboutPage() {
  const t = useTranslations('about');
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                {t('title')}
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{t('subtitle')}</p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="prose prose-lg max-w-none">
              <h2>{t('missionTitle')}</h2>
              <p>{t('missionP1')}</p>
              <p>{t('missionP2')}</p>

              <h2>{t('buildingTitle')}</h2>
              <p>{t('buildingBody')}</p>
              <ul>
                {BUILDING_POINTS.map((point) => (
                  <li key={point}>{t(`buildingList.${point}`)}</li>
                ))}
              </ul>

              <h2>{t('openSourceTitle')}</h2>
              <p>
                {t.rich('openSourceBody', {
                  link: (chunks) => (
                    <Link
                      href="https://github.com/profullstack/pairux.com"
                      className="text-primary-600 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>

              <h2>{t('contactTitle')}</h2>
              <p>
                {t.rich('contactBody', {
                  link: (chunks) => (
                    <Link
                      href="mailto:hello@pairux.com"
                      className="text-primary-600 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
