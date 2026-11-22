import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { RoomGate } from './room-gate';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('rooms');
  return { title: t('metaTitle', { slug }), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default async function PersonalRoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <RoomGate slug={slug.toLowerCase()} header={<Header />} />;
}
