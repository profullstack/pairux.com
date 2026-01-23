'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Monitor, ArrowLeft } from 'lucide-react';
import { HeaderClient } from '@/components/header-client';
import type { UserData } from '@/components/header';

interface SessionResponse {
  user: UserData | null;
}

/**
 * Parse a join code from user input. Handles both raw codes and full URLs.
 */
function parseJoinInput(input: string): string {
  const trimmed = input.trim();
  // Try to extract code from URL pattern
  const urlMatch = /\/join\/([A-Z0-9]{6})/i.exec(trimmed);
  if (urlMatch?.[1]) {
    return urlMatch[1].toUpperCase();
  }
  // Otherwise treat as raw code - strip non-alphanumeric and uppercase
  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export default function JoinInputPage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = parseJoinInput(input);

    if (code.length !== 6) {
      setError('Please enter a valid 6-character join code');
      return;
    }

    router.push(`/join/${code}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <HeaderClient user={user} />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <div className="bg-primary-100 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <Monitor className="text-primary-600 h-6 w-6" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-gray-900">Join a Session</h1>
              <p className="mt-2 text-sm text-gray-600">Enter a join code or paste a link</p>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="joinInput" className="block text-sm font-medium text-gray-700">
                  Join Code or Link
                </label>
                <input
                  id="joinInput"
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError('');
                  }}
                  placeholder="ABC123 or paste link"
                  className="focus:border-primary-500 focus:ring-primary-500 mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-center font-mono text-lg text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none"
                  autoFocus
                />
                <p className="mt-1.5 text-center text-xs text-gray-500">
                  Enter the 6-character code or paste a join link
                </p>
              </div>

              <button
                type="submit"
                disabled={!input.trim()}
                className="bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow transition-all focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
              </button>

              <Link
                href="/"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Link>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
