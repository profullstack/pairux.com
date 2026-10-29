'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Wallet, Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { coinpayErrorKey } from '@/components/auth/CoinpaySignIn';

interface CpStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  canDisconnect: boolean;
}

/**
 * Connect / Disconnect CoinPay (the house master account) so it can sign in to
 * this PairUX account. Connecting needs this session; disconnecting is refused
 * when CoinPay is the only way in.
 */
export function CoinpayConnect() {
  const t = useTranslations('settings.coinpay');
  const tAuth = useTranslations('auth.coinpay');
  const searchParams = useSearchParams();
  const result = searchParams.get('coinpay');
  const errorKey = coinpayErrorKey(result);
  const [status, setStatus] = useState<CpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/coinpay/status');
      if (res.ok) {
        const json = (await res.json()) as { data: CpStatus };
        setStatus(json.data);
      }
    } catch {
      // leave status null
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/coinpay/disconnect', { method: 'POST' });
      if (!res.ok) setError(t('onlyWayIn'));
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white" id="coinpay">
      <div className="border-b border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <Wallet className="h-5 w-5 text-gray-700" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">{t('title')}</h2>
            <p className="text-sm text-gray-500">{t('description')}</p>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-6">
        {result === 'connected' && <p className="text-sm text-green-600">{t('justConnected')}</p>}
        {errorKey && <p className="text-sm text-red-600">{tAuth(`errors.${errorKey}`)}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {status === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : status.connected ? (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" />
              {status.email ? t('connectedAs', { email: status.email }) : t('connected')}
            </span>
            {status.canDisconnect ? (
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('disconnect')}
              </button>
            ) : (
              <span className="text-xs text-gray-500">{t('onlyWayIn')}</span>
            )}
          </div>
        ) : !status.configured ? (
          <p className="text-sm text-gray-500">{t('notConfigured')}</p>
        ) : (
          <a
            href="/api/v1/coinpay/oauth/start?mode=connect"
            className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            {t('connect')}
          </a>
        )}
      </div>
    </div>
  );
}
