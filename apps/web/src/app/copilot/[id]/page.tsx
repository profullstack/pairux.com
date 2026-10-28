import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { CopilotReport } from './copilot-report';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('copilotPages');
  return { title: t('reportTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default async function CopilotReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CopilotReport id={id} header={<Header />} />;
}
