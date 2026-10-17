'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useCheckout } from '@/components/billing/useCheckout';
import { upgradePath, type PaidPlan } from '@/lib/plans';

export function UpgradeCheckout({ plan }: { plan: PaidPlan }) {
  const t = useTranslations('upgradePrompt.page');
  const tiers = useTranslations('pricing.tiers');
  const { start, error } = useCheckout();
  const started = useRef(false);

  useEffect(() => {
    // Once per page load (StrictMode runs effects twice in dev).
    if (started.current) return;
    started.current = true;
    void start(plan, upgradePath(plan));
  }, [plan, start]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <Logo size="sm" />
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        {error ? (
          <>
            <p className="text-sm text-red-600">{error}</p>
            <Link
              href="/pricing"
              className="text-primary-600 mt-4 inline-block text-sm font-semibold"
            >
              {t('backToPricing')}
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="text-primary-600 mx-auto h-8 w-8 animate-spin" />
            <p className="mt-4 text-sm text-gray-700">
              {t('starting', { plan: tiers(`${plan}.name`) })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
