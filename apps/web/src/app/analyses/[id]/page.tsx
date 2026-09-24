import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { AnalysisReport } from './analysis-report';

export const metadata: Metadata = {
  title: 'Call analysis - PairUX',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AnalysisReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisReport id={id} header={<Header />} />;
}
