'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Video } from 'lucide-react';
import { CopyLink, type RoomView } from '@/app/settings/rooms/rooms-manager';

/** The user's permanent room link, front and centre on the dashboard. */
export function MyRoomCard() {
  const t = useTranslations('rooms');
  const [room, setRoom] = useState<RoomView | null>(null);

  useEffect(() => {
    fetch('/api/v1/me/rooms')
      .then((r) => (r.ok ? (r.json() as Promise<{ data?: { rooms: RoomView[] } }>) : null))
      .then((b) => {
        setRoom(b?.data?.rooms.find((r) => r.is_default) ?? b?.data?.rooms[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  if (!room) return null;
  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-indigo-900">{t('yourRoom')}</p>
        <a
          href={room.url}
          className="text-lg font-semibold break-all text-indigo-700 hover:underline"
        >
          {room.url.replace(/^https?:\/\//, '')}
        </a>
        <p className="mt-1 text-xs text-indigo-900/70">{t('yourRoomHint')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/m/${room.slug}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Video className="h-4 w-4" aria-hidden="true" />
          {t('start')}
        </Link>
        <CopyLink url={room.url} label={t('copy')} done={t('copied')} />
        <Link
          href="/settings/rooms"
          className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm text-indigo-700 hover:underline"
        >
          {t('manage')}
        </Link>
      </div>
    </section>
  );
}
