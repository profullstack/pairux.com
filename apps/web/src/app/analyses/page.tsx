import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { AnalysesList } from './analyses-list';

export const metadata: Metadata = {
  title: 'Call analyses - PairUX',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function AnalysesPage() {
  return <AnalysesList header={<Header />} />;
}
