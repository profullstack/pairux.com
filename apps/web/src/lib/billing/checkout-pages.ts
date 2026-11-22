import { createCheckout, type Account, type Checkout, type Order } from '@profullstack/checkout';
import { appBaseUrl, startPlanCheckout } from '@/lib/billing/plan-checkout';
import { COPILOT_TOPUPS, copilotTopup } from '@/lib/copilot/pricing';
import { PLANS, upgradePath, type PaidPlan } from '@/lib/plans';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';

/**
 * The checkout pages (@profullstack/checkout): /upgrade/<plan> for one term of
 * a plan and /settings/copilot/add-credit for AI copilot credit. Both open the
 * payment through startPlanCheckout, with the arguments the JSON routes
 * (/api/billing/checkout, /api/billing/copilot-topup) pass, so the CoinPay
 * session, the plan_payments row and the webhook see exactly what they always
 * have.
 */

/** Where the plan form posts. */
export const planCheckoutAction = (plan: PaidPlan) => `/api/checkout/plan/${plan}`;
/** The copilot credit page and where its form posts. */
export const COPILOT_CHECKOUT_PATH = '/settings/copilot/add-credit';
export const COPILOT_CHECKOUT_ACTION = '/api/checkout/copilot-credit';
/** /upgrade/<plan>?pay=methods: the coin and PayPal picker, for when CoinPay offers no hosted session. */
export const PAY_METHODS_QUERY = 'pay=methods';

/** The words on a checkout page (the pages pass the visitor's language). */
export interface CheckoutText {
  title: string;
  subtitle: string;
  optionsLabel: string;
  cta: string;
  processor: string;
  /** Shown when the payment page could not be opened. */
  failed: string;
}

const ENGLISH: CheckoutText = {
  title: 'Checkout',
  subtitle: '',
  optionsLabel: '',
  cta: 'Continue to payment',
  processor: 'Pay with crypto or PayPal. Payment is processed by CoinPay.',
  failed: 'Could not start checkout. Please try again.',
};

/** The signed-in buyer, from the site's own session (cookie or Bearer). Never from the form. */
export async function checkoutAccount(): Promise<Account | null> {
  const supabase = await createClient();
  const { user, error } = await getAuthenticatedUser(supabase);
  if (error || !user) return null;
  // rawEmail keeps null apart from '' so pay() passes on what the JSON routes pass.
  return { id: user.id, email: user.email ?? '', rawEmail: user.email ?? null };
}

function buyerEmail(order: Order): string | null {
  const raw = order.account.rawEmail;
  return typeof raw === 'string' ? raw : null;
}

/** Refuse to open a payment whose amount is not the one the page showed. */
function sameAmount(priceUsd: number, order: Order): void {
  if (order.quantity !== 1 || Math.round(priceUsd * 100) !== order.totalCents) {
    throw new Error(
      `checkout amount mismatch for ${order.option.id}: page ${String(order.totalCents)} cents, catalog ${String(priceUsd)} USD`
    );
  }
}

function logFailure(scope: string) {
  return (error: unknown): void => {
    console.error(`[${scope}] could not open the payment:`, error);
  };
}

/** One term of `plan`: the single option the site sells for it. */
export function planCheckout(plan: PaidPlan, text: Partial<CheckoutText> = {}): Checkout {
  const def = PLANS[plan];
  const words = { ...ENGLISH, ...text };
  return createCheckout({
    site: 'pairux.com',
    title: words.title,
    subtitle: words.subtitle,
    optionsLabel: words.optionsLabel,
    cta: words.cta,
    processor: words.processor,
    theme: 'light',
    action: planCheckoutAction(plan),
    page: upgradePath(plan),
    siteUrl: appBaseUrl(),
    // A term is TERM_DAYS (31) days, not a calendar month, so it is priced as
    // one payment and the page's own copy says what it covers.
    options: [{ id: def.id, name: def.label, price: def.priceUsd, default: true }],
    requireAccount: true,
    signIn: '/login',
    signInParam: 'redirect',
    account: checkoutAccount,
    errors: { payment_unavailable: words.failed },
    onError: logFailure('checkout/plan'),
    pay: async (order) => {
      if (order.option.id !== def.id) throw new Error(`unknown plan ${order.option.id}`);
      sameAmount(def.priceUsd, order);
      const result = await startPlanCheckout({
        plan: def,
        userId: order.account.id,
        email: buyerEmail(order),
        method: null,
      });
      // CoinPay offers no hosted session right now: the buyer picks a coin or
      // PayPal on the site's own picker, as before.
      if (result.kind === 'choose') return `${upgradePath(def.id)}?${PAY_METHODS_QUERY}`;
      return { url: result.checkoutUrl, id: result.paymentId };
    },
  });
}

/** Prepaid AI copilot credit: the three packs the settings page offers. */
export function copilotCheckout(text: Partial<CheckoutText> = {}): Checkout {
  const words = { ...ENGLISH, ...text };
  return createCheckout({
    site: 'pairux.com',
    title: words.title,
    subtitle: words.subtitle,
    optionsLabel: words.optionsLabel,
    cta: words.cta,
    processor: words.processor,
    theme: 'light',
    action: COPILOT_CHECKOUT_ACTION,
    page: COPILOT_CHECKOUT_PATH,
    siteUrl: appBaseUrl(),
    options: COPILOT_TOPUPS.map((one) => ({
      id: one.id,
      name: `$${String(one.priceUsd)}`,
      price: one.priceUsd,
    })),
    requireAccount: true,
    signIn: '/login',
    signInParam: 'redirect',
    account: checkoutAccount,
    errors: { payment_unavailable: words.failed },
    onError: logFailure('checkout/copilot-credit'),
    pay: async (order) => {
      const topup = copilotTopup(order.option.id);
      if (!topup) throw new Error(`unknown top-up ${order.option.id}`);
      sameAmount(topup.priceUsd, order);
      const result = await startPlanCheckout({
        plan: { id: topup.id, label: 'PairUX AI copilot credit', priceUsd: topup.priceUsd },
        userId: order.account.id,
        email: buyerEmail(order),
        method: null,
        description: `PairUX AI copilot credit: ${String(topup.priceUsd)} USD (pay as you go, pairux.com)`,
        returnPath: '/settings/copilot',
        type: 'copilot_credit',
      });
      // No hosted session: the settings page has never had a coin picker for
      // credit, it says checkout is unavailable. Same here.
      if (result.kind === 'choose') throw new Error('CoinPay hosted checkout is unavailable');
      return { url: result.checkoutUrl, id: result.paymentId };
    },
  });
}
