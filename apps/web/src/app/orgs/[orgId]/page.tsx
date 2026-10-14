import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { OrgDetail } from './org-detail';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orgs.meta');
  return {
    title: t('detailTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return <OrgDetail orgId={orgId} header={<Header />} />;
}
