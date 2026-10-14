import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { AnalysesList } from './analyses-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyses.meta');
  return {
    title: t('listTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

export default function AnalysesPage() {
  return <AnalysesList header={<Header />} />;
}
