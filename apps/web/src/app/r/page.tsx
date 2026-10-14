'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { newAnonRoom } from '@/lib/anon-rooms';

/** /r: start a fresh anonymous room. The id and key are made here, in the browser. */
export default function NewAnonRoomPage() {
  const t = useTranslations('room');
  useEffect(() => {
    window.location.replace(newAnonRoom(window.location.origin).url);
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">
      {t('creating')}
    </main>
  );
}
