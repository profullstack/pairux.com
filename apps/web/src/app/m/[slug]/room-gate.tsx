'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Lock, Video } from 'lucide-react';
import { DesktopHandoffOverlay } from '@/components/session/DesktopHandoffOverlay';
import { useDesktopHandoff } from '@/hooks/useDesktopHandoff';

interface PublicRoom {
  slug: string;
  name: string;
  owner: { display_name: string | null; avatar_url: string | null };
  is_owner: boolean;
  locked: boolean;
  live: boolean;
  join_code: string | null;
}

const POLL_MS = 5000;

/**
 * pairux.com/m/<slug>: a person's permanent room. The owner starts (or
 * resumes) its session; guests go straight in while the host is there and
 * wait here, polling, while they are not.
 */
export function RoomGate({ slug, header }: { slug: string; header: ReactNode }) {
  const t = useTranslations('rooms');
  const router = useRouter();
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const {
    state: handoffState,
    openSession,
    continueInBrowser,
  } = useDesktopHandoff({
    navigate: (path) => {
      router.push(path);
    },
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/rooms/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (res.status === 404) {
      setMissing(true);
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { room: PublicRoom } };
    if (body.data) setRoom(body.data.room);
    return body.data?.room ?? null;
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Guests: in as soon as the host is.
  const guestCode = room && !room.is_owner && room.live ? room.join_code : null;
  useEffect(() => {
    if (guestCode) router.replace(`/join/${guestCode}`);
  }, [guestCode, router]);

  // Waiting guests poll.
  const waiting = room && !room.is_owner && !room.live;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, load]);

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/rooms/${encodeURIComponent(slug)}/start`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { session: { id: string } };
        error?: string;
      };
      if (res.status === 401) {
        router.push(`/login?redirect=${encodeURIComponent(`/m/${slug}`)}`);
        return;
      }
      if (res.status === 403 && /pro|plan|upgrade/i.test(body.error ?? '')) {
        setError(body.error ?? t('startFailed'));
        setNeedsUpgrade(true);
        return;
      }
      if (!res.ok || !body.data) {
        setError(body.error ?? t('startFailed'));
        return;
      }
      openSession(body.data.session.id);
    } catch {
      setError(t('startFailed'));
    } finally {
      setStarting(false);
    }
  };

  const ownerName = room?.owner.display_name ?? t('someone');

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}
      <DesktopHandoffOverlay state={handoffState} onContinueInBrowser={continueInBrowser} />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          {missing ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">{t('notFound')}</h1>
              <Link href="/" className="text-primary-600 mt-4 inline-block hover:underline">
                pairux.com
              </Link>
            </>
          ) : !room ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
          ) : (
            <>
              {room.owner.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={room.owner.avatar_url}
                  alt=""
                  className="mx-auto h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="bg-primary-100 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
                  <Video className="text-primary-600 h-8 w-8" aria-hidden="true" />
                </div>
              )}
              <h1 className="mt-4 text-xl font-semibold text-gray-900">{room.name}</h1>
              <p className="mt-1 text-sm text-gray-500">pairux.com/m/{room.slug}</p>

              {room.is_owner ? (
                <div className="mt-6">
                  {needsUpgrade ? (
                    <p className="text-sm text-gray-700">
                      {error}{' '}
                      <Link href="/pricing" className="text-primary-600 hover:underline">
                        {t('seePlans')}
                      </Link>
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void start()}
                      disabled={starting}
                      className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium text-white disabled:opacity-60"
                    >
                      {starting && <Loader2 className="h-4 w-4 animate-spin" />}
                      {room.live ? t('rejoin') : t('start')}
                    </button>
                  )}
                  <p className="mt-3 text-xs text-gray-500">{t('ownerHint')}</p>
                  <Link
                    href="/settings/rooms"
                    className="text-primary-600 mt-2 inline-block text-sm hover:underline"
                  >
                    {t('manage')}
                  </Link>
                </div>
              ) : room.locked ? (
                <p className="mt-6 flex items-center justify-center gap-2 text-gray-700">
                  <Lock className="h-4 w-4" aria-hidden="true" /> {t('locked', { name: ownerName })}
                </p>
              ) : room.live ? (
                <p className="mt-6 flex items-center justify-center gap-2 text-gray-700">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('joining')}
                </p>
              ) : (
                <div className="mt-6">
                  <p className="flex items-center justify-center gap-2 text-gray-700">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('waiting', { name: ownerName })}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">{t('waitingHint')}</p>
                </div>
              )}
              {error && !needsUpgrade && <p className="mt-4 text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
