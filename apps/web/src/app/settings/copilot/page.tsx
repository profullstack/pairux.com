import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { CopilotSettings } from './copilot-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('copilotPages');
  return { title: t('settingsTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default function CopilotSettingsPage() {
  return <CopilotSettings header={<Header />} />;
}
