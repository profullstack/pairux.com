'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  Monitor,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface Participant {
  id: string;
  display_name: string;
  role: string;
  control_state: string;
  joined_at: string;
}

interface SessionData {
  id: string;
  join_code: string;
  status: string;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  created_at: string;
  session_participants: Participant[];
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export default function SessionViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = (await res.json()) as ApiResponse<SessionData>;

        if (!res.ok) {
          setError(data.error ?? 'Session not found');
          return;
        }

        if (data.data) {
          setSession(data.data);
        }
      } catch {
        setError('Failed to load session');
      } finally {
        setLoading(false);
      }
    }

    void fetchSession();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-white" />
          <p className="mt-4 text-sm text-gray-400">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-900">
        <header className="border-b border-gray-800 bg-gray-900">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center">
              <Link href="/" className="flex items-center gap-2">
                <div className="bg-primary-600 flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white">
                  P
                </div>
                <span className="text-lg font-bold text-white">PairUX</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/50">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-white">Session Not Found</h1>
            <p className="mt-2 text-sm text-gray-400">{error}</p>
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

  const activeParticipants = session.session_participants.filter((p) => p.role !== 'left');
  const isActive = session.status === 'active';

  return (
    <div className="flex min-h-screen flex-col bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2">
                <div className="bg-primary-600 flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white">
                  P
                </div>
                <span className="text-lg font-bold text-white">PairUX</span>
              </Link>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-sm text-gray-500">Session</span>
                <span className="font-mono text-sm font-semibold text-white">
                  {session.join_code}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  isActive ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
                }`}
              >
                {isActive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {isActive ? 'Connected' : session.status}
              </div>
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Leave</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <main className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center bg-black p-4">
            <div className="flex flex-col items-center text-center">
              <div className="rounded-full bg-gray-800 p-6">
                <Monitor className="h-16 w-16 text-gray-600" />
              </div>
              <h2 className="mt-6 text-xl font-semibold text-white">Waiting for screen share</h2>
              <p className="mt-2 max-w-md text-sm text-gray-400">
                The host hasn&apos;t started sharing their screen yet. You&apos;ll see their screen
                here once they begin.
              </p>
              <div className="mt-6 flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300">
                <Users className="h-4 w-4" />
                <span>{activeParticipants.length} participant(s) in session</span>
              </div>
            </div>
          </div>

          {/* Control bar */}
          <div className="flex items-center justify-center gap-4 border-t border-gray-800 bg-gray-900 px-4 py-3">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
        </main>

        {/* Participants sidebar */}
        <aside className="hidden w-64 flex-shrink-0 border-l border-gray-800 bg-gray-900 lg:block">
          <div className="p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4" />
              Participants ({activeParticipants.length})
            </h3>
            <ul className="mt-4 space-y-2">
              {activeParticipants.map((participant) => (
                <li
                  key={participant.id}
                  className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="bg-primary-600 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white">
                      {participant.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{participant.display_name}</p>
                      <p className="text-xs text-gray-500">{participant.role}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
