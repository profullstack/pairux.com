'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface UpgradeButtonProps {
  plan: 'plus' | 'pro' | 'team';
  label: string;
  className: string;
}

interface CheckoutResponse {
  data?: { checkout_url?: string | null };
  error?: string;
}

/**
 * Starts a CoinPay checkout for the multistream plugin and redirects to the
 * hosted payment page. Unauthenticated users are sent to login first. The
 * CoinPay webhook grants the plan once payment confirms.
 */
export function UpgradeButton({ plan, label, className }: UpgradeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, currency: 'card' }),
      });

      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent('/pricing')}`);
        return;
      }

      const body = (await res.json()) as CheckoutResponse;
      if (!res.ok || !body.data?.checkout_url) {
        setError(body.error ?? 'Could not start checkout. Please try again.');
        return;
      }

      window.location.href = body.data.checkout_url;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {loading ? 'Starting checkout…' : label}
      </button>
      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
    </>
  );
}
