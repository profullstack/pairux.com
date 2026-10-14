import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AnonRoom } from './room';

interface PageProps {
  params: Promise<{ room: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('room.metadata');
  return {
    title: t('title'),
    description: t('description'),
    // A room link is a secret; never index one.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function AnonRoomPage({ params }: PageProps) {
  const { room } = await params;
  return <AnonRoom room={room} />;
}
