import '@profullstack/checkout/checkout.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Checkout } from '@profullstack/checkout/react';
import { Header } from '@/components/header';
import { checkoutAccount, copilotCheckout } from '@/lib/billing/checkout-pages';
import { copilotCheckoutText } from '@/lib/billing/checkout-text';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('checkoutPage');
  return { title: t('copilotTitle'), robots: { index: false, follow: false } };
}

/**
 * /settings/copilot/add-credit: prepaid AI copilot credit. The settings page
 * links here with the amount picked (?option=copilot_credit_20); one button
 * opens the CoinPay payment page, and the buyer comes back to the settings page.
 */
export default async function AddCopilotCreditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const checkout = copilotCheckout(await copilotCheckoutText());
  const account = await checkoutAccount();
  if (!account) redirect(checkout.signInUrl(query) ?? '/login');
  const t = await getTranslations('copilotPages');

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
        <Link href="/settings/copilot" className="text-sm text-violet-700 hover:underline">
          ← {t('settingsTitle')}
        </Link>
        <div className="mt-4 rounded-xl border border-gray-200 bg-white">
          <Checkout view={checkout.view({ query, account })} />
        </div>
      </main>
    </div>
  );
}
