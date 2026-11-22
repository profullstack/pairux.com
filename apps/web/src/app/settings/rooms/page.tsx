import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { RoomsManager } from './rooms-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rooms');
  return { title: t('manageTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default function RoomsSettingsPage() {
  return <RoomsManager header={<Header />} />;
}
