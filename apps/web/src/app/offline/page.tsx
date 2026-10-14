'use client';

import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function OfflinePage() {
  const t = useTranslations('offline');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 px-4 text-white">
      <WifiOff className="mb-6 h-16 w-16 text-gray-400" />
      <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 max-w-md text-center text-gray-400">{t('description')}</p>
      <button
        onClick={() => {
          window.location.reload();
        }}
        className="rounded-lg bg-blue-600 px-6 py-3 font-medium transition-colors hover:bg-blue-700"
      >
        {t('retry')}
      </button>
    </div>
  );
}
