import { getFormatter, getTranslations } from 'next-intl/server';
import type { CheckoutText } from '@/lib/billing/checkout-pages';
import { PLANS, TERM_DAYS, type PaidPlan } from '@/lib/plans';

/** The plan checkout page's words in the visitor's language. */
export async function planCheckoutText(plan: PaidPlan): Promise<CheckoutText> {
  const [page, pricing, prompt, format] = await Promise.all([
    getTranslations('checkoutPage'),
    getTranslations('pricing'),
    getTranslations('upgradePrompt.page'),
    getFormatter(),
  ]);
  const price = format.number(PLANS[plan].priceUsd, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return {
    title: pricing(`tiers.${plan}.cta`),
    subtitle: prompt('chooseNote', { price, days: TERM_DAYS }),
    optionsLabel: pricing('cost.plan'),
    cta: page('cta'),
    processor: page('processor'),
    failed: pricing('upgrade.checkoutFailed'),
  };
}

/** The copilot credit page's words in the visitor's language. */
export async function copilotCheckoutText(): Promise<CheckoutText> {
  const [page, copilot] = await Promise.all([
    getTranslations('checkoutPage'),
    getTranslations('copilotPages'),
  ]);
  return {
    title: page('copilotTitle'),
    subtitle: copilot('walletIntro'),
    optionsLabel: page('amount'),
    cta: page('cta'),
    processor: page('processor'),
    failed: copilot('checkoutUnavailable'),
  };
}
