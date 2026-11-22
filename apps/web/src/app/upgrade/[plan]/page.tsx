import '@profullstack/checkout/checkout.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Checkout } from '@profullstack/checkout/react';
import { Logo } from '@/components/Logo';
import { checkoutAccount, planCheckout } from '@/lib/billing/checkout-pages';
import { planCheckoutText } from '@/lib/billing/checkout-text';
import { getPlanDef } from '@/lib/plans';
import { UpgradeCheckout } from './UpgradeCheckout';

interface UpgradePageProps {
  params: Promise<{ plan: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('upgradePrompt.page');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * /upgrade/<plan>: the checkout page for one term of a plan. The pricing page,
 * the desktop app, push notifications and API error messages link here.
 * Signed-out buyers log in first and come straight back; one button then opens
 * the CoinPay payment page.
 *
 * `?payment=success` is where CoinPay sends the buyer back, and `?pay=methods`
 * is the coin and PayPal picker for when CoinPay offers no hosted checkout.
 */
export default async function UpgradePage({ params, searchParams }: UpgradePageProps) {
  const { plan } = await params;
  const query = await searchParams;
  const def = getPlanDef(plan);
  if (!def) notFound();
  if (query.payment === 'success') return <UpgradeCheckout plan={def.id} paid />;
  if (query.pay === 'methods') return <UpgradeCheckout plan={def.id} />;

  const checkout = planCheckout(def.id, await planCheckoutText(def.id));
  const account = await checkoutAccount();
  if (!account) redirect(checkout.signInUrl(query) ?? '/login');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4 py-10">
      <Logo size="sm" />
      <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white shadow-sm">
        <Checkout view={checkout.view({ query, account })} />
      </div>
    </div>
  );
}
