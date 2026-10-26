'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * /i/<code>: keep the invite in a cookie for 30 days so it survives signup
 * and the email confirmation link, then offer signup (or one-click accept
 * for a signed-in, new account).
 */
export function InviteLanding({
  code,
  signedIn,
  cookieName,
}: {
  code: string;
  signedIn: boolean;
  cookieName: string;
}) {
  const t = useTranslations('credits.landing');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${cookieName}=${encodeURIComponent(code)}; path=/; max-age=${String(30 * 86400)}; samesite=lax${secure}`;
  }, [code, cookieName]);

  async function accept() {
    setBusy(true);
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { message: string };
        error?: string;
      };
      setMsg(
        body.data
          ? { ok: true, text: body.data.message }
          : { ok: false, text: body.error ?? t('failed') }
      );
      if (body.data) {
        document.cookie = `${cookieName}=; path=/; max-age=0`;
        setTimeout(() => {
          router.push('/dashboard#billing');
        }, 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
      <p className="mt-3 text-gray-600">{t('body')}</p>
      <p className="mt-4 font-mono text-sm text-gray-500">{code}</p>
      {signedIn ? (
        <button
          onClick={() => void accept()}
          disabled={busy}
          className="bg-primary-600 hover:bg-primary-700 mt-6 w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50"
        >
          {t('accept')}
        </button>
      ) : (
        <div className="mt-6 space-y-3">
          <Link
            href={`/signup?invite=${encodeURIComponent(code)}`}
            className="bg-primary-600 hover:bg-primary-700 block w-full rounded-lg py-3 font-semibold text-white"
          >
            {t('signup')}
          </Link>
          <Link
            href={`/login?redirect=${encodeURIComponent(`/i/${code}`)}`}
            className="block text-sm text-gray-600 underline"
          >
            {t('login')}
          </Link>
        </div>
      )}
      {msg && (
        <p role="status" className={`mt-4 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
