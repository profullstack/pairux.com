'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { finishConnect } from '@/lib/c0mpute-publish';

/** Where c0mpute.com sends the browser back after the user approves uploads. */
export default function C0mputeCallbackPage() {
  const t = useTranslations('recordings.publish');
  const [error, setError] = useState('');

  useEffect(() => {
    finishConnect(new URLSearchParams(window.location.search))
      .then((next) => {
        window.location.replace(next);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center">
      {error ? (
        <>
          <p className="text-red-600">{t('callbackError', { message: error })}</p>
          <Link href="/recordings" className="mt-4 inline-block text-blue-600 hover:underline">
            {t('back')}
          </Link>
        </>
      ) : (
        <p className="flex items-center justify-center gap-2 text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('callbackWorking')}
        </p>
      )}
    </main>
  );
}
