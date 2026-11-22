import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { RecordingsList } from './recordings-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recordings.meta');
  return { title: t('listTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default function RecordingsPage() {
  return <RecordingsList header={<Header />} />;
}
