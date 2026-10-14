import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { AnalysisReport } from './analysis-report';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyses.meta');
  return {
    title: t('detailTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

export default async function AnalysisReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisReport id={id} header={<Header />} />;
}
