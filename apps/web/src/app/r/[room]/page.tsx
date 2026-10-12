import type { Metadata } from 'next';
import { AnonRoom } from './room';

interface PageProps {
  params: Promise<{ room: string }>;
}

export const metadata: Metadata = {
  title: 'Encrypted room',
  description: 'An end-to-end encrypted PairUX voice and video room. No account needed.',
  // A room link is a secret; never index one.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function AnonRoomPage({ params }: PageProps) {
  const { room } = await params;
  return <AnonRoom room={room} />;
}
