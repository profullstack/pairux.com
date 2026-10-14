/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Link2, Copy, Check, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { HeaderClient } from '@/components/header-client';
import type { UserData } from '@/components/header';

interface SessionResponse {
  user: UserData | null;
}

interface SessionInfo {
  id: string;
  join_code: string;
  status: string;
}

export default function CreateLinkPage() {
  const t = useTranslations('createLink');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);

  // Fetch user session on mount
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = (await res.json()) as SessionResponse;
          setUser(data.user);
        }
      } catch {
        // User not logged in
      }
    }
    void fetchUser();
  }, []);

  async function handleCreateLink() {
    setIsCreating(true);
    setError('');
    setNeedsSignIn(false);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // These links are hosted from the desktop app, which is the only host
          // that can actually inject input. Guests may ask for control; the
          // desktop host still approves each request before anything is
          // injected. (Web-hosted sessions keep this off — a browser has no OS
          // to drive, so the request could never be satisfied.)
          allowGuestControl: true,
          maxParticipants: 5,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setError(t('signInRequired'));
          setNeedsSignIn(true);
        } else {
          setError(data.error || t('createFailed'));
        }
        return;
      }

      setSession(data.data);
    } catch {
      setError(t('createFailed'));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopyLink() {
    if (!session) return;

    const joinUrl = `https://pairux.com/join/${session.join_code}`;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  const joinUrl = session ? `https://pairux.com/join/${session.join_code}` : '';

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <HeaderClient user={user} />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <div className="bg-primary-100 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <Link2 className="text-primary-600 h-6 w-6" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-gray-900">{t('title')}</h1>
              <p className="mt-2 text-sm text-gray-600">{t('subtitle')}</p>
            </div>

            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
                {needsSignIn && (
                  <Link href="/login?redirect=/create-link" className="ml-1 font-medium underline">
                    {t('signIn')}
                  </Link>
                )}
              </div>
            )}

            {!session ? (
              <div className="space-y-4">
                <button
                  onClick={() => void handleCreateLink()}
                  disabled={isCreating}
                  className="bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow transition-all focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('creating')}
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4" />
                      {t('createButton')}
                    </>
                  )}
                </button>

                <Link
                  href="/"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('backHome')}
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-gray-50 p-4 text-center">
                  <p className="mb-2 text-sm text-gray-600">{t('joinCode')}</p>
                  <p className="font-mono text-3xl font-bold tracking-widest text-gray-900">
                    {session.join_code}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-gray-600">{t('joinUrl')}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800">
                      {joinUrl}
                    </code>
                    <button
                      onClick={() => void handleCopyLink()}
                      aria-label={copied ? t('copied') : t('copyLink')}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white transition-colors hover:bg-gray-50"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4 text-gray-600" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-sm text-gray-600">{t('shareHint')}</p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => {
                      setSession(null);
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    {t('createAnother')}
                  </button>
                  <Link
                    href="/download"
                    className="bg-primary-600 hover:bg-primary-700 flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                  >
                    {t('downloadApp')}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
