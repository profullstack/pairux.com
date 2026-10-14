import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { ForgotPasswordForm } from '@/components/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgot.meta');
  return { title: t('title'), description: t('description') };
}

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgot');
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
