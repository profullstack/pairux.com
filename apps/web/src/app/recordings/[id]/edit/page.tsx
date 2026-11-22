import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { RecordingEditor } from './recording-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recordings.meta');
  return { title: t('editTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default async function EditRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecordingEditor id={id} header={<Header />} />;
}
