import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { SignupForm } from '@/components/auth';
import { Gift, CreditCard, Coins, Sparkles, Check } from 'lucide-react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signup.meta');
  return { title: t('title'), description: t('description') };
}

export default function SignupPage() {
  const t = useTranslations('auth.signup.page');
  const bold = (chunks: React.ReactNode) => <span className="font-bold">{chunks}</span>;
  const semibold = (chunks: React.ReactNode) => <span className="font-semibold">{chunks}</span>;
  const medium = (chunks: React.ReactNode) => <span className="font-medium">{chunks}</span>;
  return (
    <div className="space-y-6">
      {/* Early Adopter Banner */}
      <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">{t('earlyAdopterTitle')}</h3>
            <p className="mt-1 text-sm text-amber-700">{t.rich('earlyAdopterBody', { bold })}</p>
          </div>
        </div>
      </div>

      {/* Waitlist Deposit Card */}
      <div className="border-primary-200 from-primary-50 rounded-xl border-2 bg-gradient-to-br to-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Gift className="text-primary-600 h-5 w-5" />
          <h2 className="text-lg font-bold text-gray-900">{t('waitlistTitle')}</h2>
          <span className="bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 text-xs font-medium">
            {t('recommended')}
          </span>
        </div>

        <p className="mt-2 text-sm text-gray-600">{t('waitlistBody')}</p>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>{t.rich('perkCredits', { semibold })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>{t('perkPriority')}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>{t('perkPricing')}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500" />
            <span>{t('perkCommunity')}</span>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <h4 className="text-sm font-medium text-gray-700">{t('paymentMethods')}</h4>

          {/* Stripe */}
          <button
            disabled
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">{t('payCard')}</p>
                <p className="text-xs text-gray-500">{t('payCardDetail')}</p>
              </div>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              {t('comingSoon')}
            </span>
          </button>

          {/* CoinPayPortal */}
          <button
            disabled
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-all hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-gray-600" />
              <div>
                <p className="font-medium text-gray-900">{t('payCrypto')}</p>
                <p className="text-xs text-gray-500">{t('payCryptoDetail')}</p>
              </div>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              {t('comingSoon')}
            </span>
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">{t('refundable')}</p>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-gray-50 px-4 text-gray-500">{t('orFree')}</span>
        </div>
      </div>

      {/* Regular Signup */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-gray-900">{t('freeTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('freeBody')}</p>
        </div>
        <SignupForm />
      </div>

      {/* Credit System Info */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h4 className="font-medium text-gray-900">{t('creditsTitle')}</h4>
        <p className="mt-1 text-sm text-gray-600">{t.rich('creditsBody', { medium })}</p>
      </div>
    </div>
  );
}
