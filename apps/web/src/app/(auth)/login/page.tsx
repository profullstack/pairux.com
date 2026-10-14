import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login.meta');
  return { title: t('title'), description: t('description') };
}

export default function LoginPage() {
  const t = useTranslations('auth.login');
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-gray-100" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
