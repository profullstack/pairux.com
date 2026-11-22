import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { C0mputePublisher } from './publisher';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recordings.publish');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default async function PublishRecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <C0mputePublisher id={id} header={<Header />} />;
}
