/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-misused-promises */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Loader2, AlertCircle, Users, Monitor } from 'lucide-react';

interface SessionInfo {
  id: string;
  join_code: string;
  status: string;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  participant_count: number;
}

export default function JoinPage({ params }: { params: Promise<{ joinCode: string }> }) {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    params.then(({ joinCode }) => {
      setJoinCode(joinCode);
    });
  }, [params]);

  useEffect(() => {
    if (!joinCode) return;

    async function lookupSession() {
      try {
        const res = await fetch(`/api/sessions/join/${joinCode}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Session not found');
          setLoading(false);
          return;
        }

        setSession(data.data);
      } catch {
        setError('Failed to lookup session');
      } finally {
        setLoading(false);
      }
    }

    lookupSession();
  }, [joinCode]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode) return;

    setError('');
    setJoining(true);

    try {
      const res = await fetch(`/api/sessions/join/${joinCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to join session');
        return;
      }

      // Redirect to session viewer
      router.push(`/session/${session?.id}`);
    } catch {
      setError('Failed to join session');
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="text-primary-600 mx-auto h-8 w-8 animate-spin" />
          <p className="mt-4 text-sm text-gray-600">Looking up session...</p>
        </div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center">
              <Link href="/" className="flex items-center gap-2">
                <div className="bg-primary-600 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
                  P
                </div>
                <span className="text-xl font-bold text-gray-900">PairUX</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-gray-900">Session Not Found</h1>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
            <Link
              href="/"
              className="bg-primary-600 hover:bg-primary-700 mt-6 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              Go to Homepage
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="bg-primary-600 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
                P
              </div>
              <span className="text-xl font-bold text-gray-900">PairUX</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <div className="bg-primary-100 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <Monitor className="text-primary-600 h-6 w-6" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-gray-900">Join Session</h1>
              <p className="mt-2 text-sm text-gray-600">
                You&apos;re about to join a screen sharing session
              </p>
            </div>

            {session && (
              <div className="mb-6 rounded-lg bg-gray-50 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Session Code</span>
                  <span className="font-mono font-semibold text-gray-900">{session.join_code}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Participants</span>
                  <span className="flex items-center gap-1 text-gray-900">
                    <Users className="h-4 w-4" />
                    {session.participant_count} / {session.settings.maxParticipants || 5}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
                  Your Name
                </label>
                <div className="relative mt-1">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                    }}
                    required
                    minLength={2}
                    maxLength={50}
                    className="focus:border-primary-500 focus:ring-primary-500 block w-full rounded-lg border border-gray-300 py-2.5 pr-3 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none"
                    placeholder="Enter your name"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  This is how others will see you in the session
                </p>
              </div>

              <button
                type="submit"
                disabled={joining || !displayName.trim()}
                className="bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow transition-all focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joining && <Loader2 className="h-4 w-4 animate-spin" />}
                {joining ? 'Joining...' : 'Join Session'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-500">
              Have an account?{' '}
              <Link
                href={`/login?redirect=/join/${joinCode}`}
                className="text-primary-600 hover:text-primary-500 font-medium"
              >
                Sign in
              </Link>{' '}
              for a better experience
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
