'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Monitor, Loader2, AlertCircle, ArrowRight, Shield, Users, Settings } from 'lucide-react';
import { HeaderClient } from '@/components/header-client';

interface SessionData {
  id: string;
  join_code: string;
  status: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

// Settings key (same as in settings page)
const SETTINGS_KEY = 'pairux-web-settings';

export default function StartHostPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(5);
  // allowGuestControl is always false for web hosting (disabled)
  const allowGuestControl = false;

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as {
          session?: { defaultMaxParticipants?: number };
        };
        if (parsed.session?.defaultMaxParticipants) {
          setMaxParticipants(parsed.session.defaultMaxParticipants);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  const createSession = useCallback(async () => {
    setIsCreating(true);
    setError('');

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allowGuestControl,
          maxParticipants,
        }),
      });

      const data = (await res.json()) as ApiResponse<SessionData>;

      if (!res.ok) {
        if (res.status === 401) {
          // Redirect to login
          router.push('/login?redirect=/host');
          return;
        }
        setError(data.error ?? 'Failed to create session');
        return;
      }

      if (data.data) {
        // Redirect to the host session page
        router.push(`/host/${data.data.id}`);
      }
    } catch {
      setError('Failed to create session. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }, [router, maxParticipants, allowGuestControl]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <HeaderClient user={null} />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="bg-primary-100 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl">
              <Monitor className="text-primary-600 h-8 w-8" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-gray-900">Share Your Screen</h1>
            <p className="mt-2 text-gray-600">
              Start a view-only screen sharing session from your browser
            </p>
          </div>

          {/* Settings Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Session Settings</h2>
              <Link
                href="/settings"
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <Settings className="h-4 w-4" />
                Defaults
              </Link>
            </div>

            {/* Error message */}
            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Max participants */}
            <div className="mt-6">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Users className="h-4 w-4 text-gray-400" />
                Maximum Viewers
              </label>
              <select
                value={maxParticipants}
                onChange={(e) => {
                  setMaxParticipants(Number(e.target.value));
                }}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value={2}>2 viewers</option>
                <option value={5}>5 viewers</option>
                <option value={10}>10 viewers</option>
              </select>
            </div>

            {/* Guest control toggle - disabled for web hosting */}
            <div className="mt-6">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Shield className="h-4 w-4 text-gray-400" />
                Remote Control
              </label>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-gray-200 transition-colors`}
                >
                  <span className="sr-only">Enable guest control</span>
                  <span
                    className={`inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition-transform`}
                  />
                </button>
                <span className="text-sm text-gray-500">Not available in web sharing</span>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Remote control requires the{' '}
                <Link href="/download" className="text-primary-600 hover:underline">
                  desktop app
                </Link>
                .
              </p>
            </div>

            {/* Start button */}
            <button
              type="button"
              onClick={() => void createSession()}
              disabled={isCreating}
              className="bg-primary-600 hover:bg-primary-700 mt-8 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Creating session...
                </>
              ) : (
                <>
                  Start Sharing
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </div>

          {/* Info note */}
          <div className="mt-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
            <p className="text-sm text-yellow-800">
              <strong>Web sharing is view-only.</strong> Viewers can see your screen but cannot
              control it. For remote control features, use the desktop app.
            </p>
          </div>

          {/* Link to join instead */}
          <p className="mt-6 text-center text-sm text-gray-500">
            Want to join a session instead?{' '}
            <Link href="/join" className="text-primary-600 hover:underline">
              Enter join code
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
