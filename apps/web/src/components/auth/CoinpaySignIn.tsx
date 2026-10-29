'use client';

import { useTranslations } from 'next-intl';

/** The `?coinpay=` result codes the CoinPay routes redirect with, as message keys. */
export function coinpayErrorKey(
  code: string | null | undefined
): 'retry' | 'unavailable' | 'unconfirmed' | 'linkedElsewhere' | 'alreadyConnected' | null {
  if (!code || code === 'connected') return null;
  switch (code) {
    case 'unavailable':
      return 'unavailable';
    case 'unconfirmed':
      return 'unconfirmed';
    case 'linked_elsewhere':
      return 'linkedElsewhere';
    case 'already_connected':
      return 'alreadyConnected';
    default:
      return 'retry';
  }
}

/**
 * "Sign in with CoinPay": CoinPay is the house master account, so it comes
 * first. A plain link, deliberately: the start route sets the PKCE/state cookie
 * and 302s to CoinPay, which needs a full navigation.
 */
export function CoinpaySignIn({ mode, next }: { mode: 'login' | 'signup'; next?: string | null }) {
  const t = useTranslations('auth');
  const href = `/api/v1/coinpay/oauth/start?mode=login${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  return (
    <div className="space-y-5">
      <a
        href={href}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow transition-all hover:bg-gray-800 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 focus:outline-none"
      >
        {mode === 'signup' ? t('coinpay.signUp') : t('coinpay.signIn')}
      </a>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-gray-500">{t('coinpay.orEmail')}</span>
        </div>
      </div>
    </div>
  );
}
