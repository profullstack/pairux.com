import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { AgentsSettings } from './agents-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('copilotPages');
  return { title: t('agents.title'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default function AgentsSettingsPage() {
  return <AgentsSettings header={<Header />} />;
}
