import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { OrgsList } from './orgs-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orgs.meta');
  return {
    title: t('listTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

export default function OrgsPage() {
  return <OrgsList header={<Header />} />;
}
