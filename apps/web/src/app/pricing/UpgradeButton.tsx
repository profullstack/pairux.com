'use client';

import { useTranslations } from 'next-intl';
import { useCheckout } from '@/components/billing/useCheckout';

interface UpgradeButtonProps {
  plan: 'plus' | 'pro' | 'team';
  label: string;
  className: string;
}

/**
 * Starts a CoinPay checkout for the plan and redirects to the hosted payment
 * page. Unauthenticated users are sent to login first. The CoinPay webhook
 * grants the plan once payment confirms.
 */
export function UpgradeButton({ plan, label, className }: UpgradeButtonProps) {
  const t = useTranslations('pricing.upgrade');
  const { start, loading, error } = useCheckout();

  return (
    <>
      <button
        type="button"
        onClick={() => void start(plan, '/pricing')}
        disabled={loading}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {loading ? t('starting') : label}
      </button>
      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
    </>
  );
}
