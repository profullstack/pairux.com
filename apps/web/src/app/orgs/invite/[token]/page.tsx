import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { AcceptInvite } from './accept-invite';

export const metadata: Metadata = {
  title: 'Join an organization - PairUX',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} header={<Header />} />;
}
