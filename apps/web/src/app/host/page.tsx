import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { StartHost } from './start-host';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hostStart');
  return { title: t('metaTitle') };
}

export const dynamic = 'force-dynamic';

export default function StartHostPage() {
  return <StartHost header={<Header />} />;
}
