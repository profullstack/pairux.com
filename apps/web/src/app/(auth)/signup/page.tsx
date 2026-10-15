import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { maxListeners } from '@pairux/shared-types';
import { SignupForm } from '@/components/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signup.meta');
  return { title: t('title'), description: t('description') };
}

export default function SignupPage() {
  const t = useTranslations('auth.signup.page');
  // The free-tier line is the /pricing one, with the same cap (LISTENER_CAP),
  // so the two pages cannot disagree again.
  const tPricing = useTranslations('pricing.tiers.free.features');
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-gray-900">{t('freeTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {tPricing('participants', { count: maxListeners('free') })}
          </p>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}
