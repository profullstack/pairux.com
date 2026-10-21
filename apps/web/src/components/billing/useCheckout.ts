'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { upgradePath, type PaidPlan } from '@/lib/plans';

export interface CheckoutMethodOption {
  id: string;
  label: string;
}

interface CheckoutResponse {
  data?: {
    checkout_url?: string | null;
    choose_method?: boolean;
    methods?: CheckoutMethodOption[];
  };
  error?: string;
}

interface UseCheckoutResult {
  /**
   * Start a CoinPay checkout for `plan`; signed-out buyers go to login, then
   * `returnTo`. With no `method`, CoinPay's hosted checkout is used when it is
   * offered; otherwise the buyer picks a coin or PayPal on /upgrade/<plan>.
   */
  start: (plan: PaidPlan, returnTo: string, method?: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  /** Set when the buyer has to pick how to pay (only /upgrade/<plan> shows it). */
  methods: CheckoutMethodOption[] | null;
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
  const [methods, setMethods] = useState<CheckoutMethodOption[] | null>(null);

  const start = useCallback(
    async (plan: PaidPlan, returnTo: string, method?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(method ? { plan, method } : { plan }),
        });

        // LoginForm reads ?redirect= (the old ?next= was ignored, so signed-out
        // buyers landed on the dashboard instead of back at checkout).
        if (res.status === 401) {
          router.push(`/login?redirect=${encodeURIComponent(returnTo)}`);
          return;
        }

        const body = (await res.json()) as CheckoutResponse;
        if (res.ok && body.data?.choose_method) {
          const picker = upgradePath(plan);
          if (typeof window !== 'undefined' && window.location.pathname !== picker) {
            router.push(picker);
            return;
          }
          setMethods(body.data.methods ?? []);
          return;
        }
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

  return { start, loading, error, methods };
}
