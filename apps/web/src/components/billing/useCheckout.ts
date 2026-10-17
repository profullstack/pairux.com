'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PaidPlan } from '@/lib/plans';

interface CheckoutResponse {
  data?: { checkout_url?: string | null };
  error?: string;
}

interface UseCheckoutResult {
  /** Start a CoinPay checkout for `plan`; signed-out buyers go to login, then `returnTo`. */
  start: (plan: PaidPlan, returnTo: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Starts a CoinPay checkout (POST /api/billing/checkout) and redirects to the
 * hosted payment page. The CoinPay webhook grants the plan once payment
 * confirms. Shared by the pricing page, the in-call upgrade prompts and
 * /upgrade/<plan>.
 */
export function useCheckout(): UseCheckoutResult {
  const t = useTranslations('pricing.upgrade');
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (plan: PaidPlan, returnTo: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Pay in USDC on Polygon (low fees, settles to the merchant wallet).
          // Card requires Stripe Connect onboarding — add once that's completed.
          body: JSON.stringify({ plan, currency: 'usdc_pol' }),
        });

        // LoginForm reads ?redirect= (the old ?next= was ignored, so signed-out
        // buyers landed on the dashboard instead of back at checkout).
        if (res.status === 401) {
          router.push(`/login?redirect=${encodeURIComponent(returnTo)}`);
          return;
        }

        const body = (await res.json()) as CheckoutResponse;
        if (!res.ok || !body.data?.checkout_url) {
          setError(body.error ?? t('checkoutFailed'));
          return;
        }

        window.location.href = body.data.checkout_url;
      } catch {
        setError(t('networkError'));
      } finally {
        setLoading(false);
      }
    },
    [router, t]
  );

  return { start, loading, error };
}
