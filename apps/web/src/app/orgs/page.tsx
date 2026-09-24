import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { OrgsList } from './orgs-list';

export const metadata: Metadata = {
  title: 'Organizations - PairUX',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function OrgsPage() {
  return <OrgsList header={<Header />} />;
}
