'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useCheckout } from '@/components/billing/useCheckout';
import { PLANS, TERM_DAYS, upgradePath, type PaidPlan } from '@/lib/plans';

/**
 * Starts the checkout as soon as the page loads. When CoinPay's hosted
 * checkout is available the buyer goes straight there; otherwise they pick a
 * coin or PayPal here. `?payment=success` is where CoinPay sends them back.
 */
export function UpgradeCheckout({ plan, paid = false }: { plan: PaidPlan; paid?: boolean }) {
  const t = useTranslations('upgradePrompt.page');
  const tiers = useTranslations('pricing.tiers');
  const format = useFormatter();
  const { start, error, methods, loading } = useCheckout();
  const [picked, setPicked] = useState<string | null>(null);
  const started = useRef(false);
  const planName = tiers(`${plan}.name`);
  const price = format.number(PLANS[plan].priceUsd, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  useEffect(() => {
    // Once per page load (StrictMode runs effects twice in dev).
    if (paid || started.current) return;
    started.current = true;
    void start(plan, upgradePath(plan));
  }, [paid, plan, start]);

  let body: React.ReactNode;
  if (paid) {
    body = (
      <>
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
        <p className="mt-4 text-sm text-gray-700" data-testid="upgrade-paid">
          {t('paid', { plan: planName })}
        </p>
        <Link
          href="/dashboard"
          className="text-primary-600 mt-4 inline-block text-sm font-semibold"
        >
          {t('toDashboard')}
        </Link>
      </>
    );
  } else if (methods && !error) {
    body = (
      <>
        <h1 className="text-lg font-semibold text-gray-900">
          {t('chooseTitle', { plan: planName })}
        </h1>
        <p className="mt-1 text-sm text-gray-600">{t('chooseNote', { price, days: TERM_DAYS })}</p>
        <div className="mt-5 grid gap-2 text-left" data-testid="upgrade-methods">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={loading}
              data-method={m.id}
              onClick={() => {
                setPicked(m.id);
                void start(plan, upgradePath(plan), m.id);
              }}
              className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm transition-colors disabled:opacity-60 ${
                m.id === 'PAYPAL' || m.id === 'USDC_POL'
                  ? 'border-primary-300 bg-primary-50 hover:bg-primary-100 font-semibold text-gray-900'
                  : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span>{m.label}</span>
              {loading && picked === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </button>
          ))}
        </div>
      </>
    );
  } else if (error) {
    body = (
      <>
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/pricing" className="text-primary-600 mt-4 inline-block text-sm font-semibold">
          {t('backToPricing')}
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <Loader2 className="text-primary-600 mx-auto h-8 w-8 animate-spin" />
        <p className="mt-4 text-sm text-gray-700">{t('starting', { plan: planName })}</p>
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <Logo size="sm" />
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        {body}
      </div>
    </div>
  );
}
