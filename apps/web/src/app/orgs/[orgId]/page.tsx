import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { OrgDetail } from './org-detail';

export const metadata: Metadata = {
  title: 'Organization - PairUX',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return <OrgDetail orgId={orgId} header={<Header />} />;
}
