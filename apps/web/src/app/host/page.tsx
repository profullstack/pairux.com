import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { StartHost } from './start-host';

export const metadata: Metadata = {
  title: 'Share your screen - PairUX',
};

export const dynamic = 'force-dynamic';

export default function StartHostPage() {
  return <StartHost header={<Header />} />;
}
