import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPlanDef } from '@/lib/plans';
import { UpgradeCheckout } from './UpgradeCheckout';

interface UpgradePageProps {
  params: Promise<{ plan: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('upgradePrompt.page');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * /upgrade/<plan>: a one-click link into the CoinPay checkout for a plan. The
 * desktop app, push notifications and API error messages link here; the page
 * starts the checkout as soon as it loads (signed-out buyers log in first and
 * come straight back).
 */
export default async function UpgradePage({ params }: UpgradePageProps) {
  const { plan } = await params;
  const def = getPlanDef(plan);
  if (!def) notFound();
  return <UpgradeCheckout plan={def.id} />;
}
