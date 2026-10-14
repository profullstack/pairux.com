import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { AcceptInvite } from './accept-invite';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orgInvite');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} header={<Header />} />;
}
