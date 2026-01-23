'use client';

import { useState, useEffect, use, useCallback } from 'react';
import Link from 'next/link';
import { Users, Copy, Check, LogOut, Loader2, AlertCircle, Share2, Eye } from 'lucide-react';
import { VideoPreview } from '@/components/video';
import { useScreenCapture } from '@/hooks/useScreenCapture';
import { useWebRTCHost } from '@/hooks/useWebRTCHost';

interface SessionData {
  id: string;
  join_code: string;
  status: string;
  host_user_id: string;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  created_at: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export default function HostSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Screen capture hook
  const {
    stream,
    captureState,
    error: captureError,
    startCapture,
    stopCapture,
  } = useScreenCapture();

  // WebRTC host hook
  const {
    isHosting,
    viewerCount,
    error: hostingError,
    startHosting,
    stopHosting,
  } = useWebRTCHost({
    sessionId,
    hostId: session?.host_user_id ?? sessionId,
    localStream: stream,
    onViewerJoined: (viewerId) => {
      console.log('Viewer joined:', viewerId);
    },
    onViewerLeft: (viewerId) => {
      console.log('Viewer left:', viewerId);
    },
  });

  // Fetch session details
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

  // Start hosting when stream is available
  useEffect(() => {
    if (stream && !isHosting) {
      startHosting();
    }
  }, [stream, isHosting, startHosting]);

  // Stop hosting when stream ends
  useEffect(() => {
    if (!stream && isHosting) {
      stopHosting();
    }
  }, [stream, isHosting, stopHosting]);

  // Copy join link to clipboard
  const copyJoinLink = useCallback(async () => {
    if (!session) return;

    const joinUrl = `${window.location.origin}/join/${session.join_code}`;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [session]);

  // Handle stop sharing
  const handleStopSharing = useCallback(() => {
    stopCapture();
    stopHosting();
  }, [stopCapture, stopHosting]);

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

  const displayError = captureError ?? hostingError;

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
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-xs font-medium text-green-400">
                  Hosting
                </span>
                {captureState !== 'active' && (
                  <span className="text-sm text-gray-500">(View Only)</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Viewer count */}
              <div className="flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300">
                <Eye className="h-3.5 w-3.5" />
                {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
              </div>

              {/* End session button */}
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">End</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <main className="flex flex-1 flex-col">
          <VideoPreview
            stream={stream}
            captureState={captureState}
            error={displayError}
            onStartCapture={() => void startCapture()}
            onStopCapture={handleStopSharing}
            className="flex-1"
          />

          {/* Info bar */}
          <div className="border-t border-gray-800 bg-gray-900 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Join code */}
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-xs text-gray-500">Join Code</p>
                  <p className="font-mono text-lg font-bold text-white">{session.join_code}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyJoinLink()}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-green-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Link
                    </>
                  )}
                </button>
              </div>

              {/* Share buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyJoinLink()}
                  className="bg-primary-600 hover:bg-primary-700 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                  <Share2 className="h-4 w-4" />
                  Share Session
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Info sidebar */}
        <aside className="hidden w-72 flex-shrink-0 border-l border-gray-800 bg-gray-900 lg:block">
          <div className="p-4">
            {/* Session info */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-white">Session Info</h3>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs text-gray-500">Status</p>
                  <p className="text-sm text-white">
                    {captureState === 'active' ? 'Sharing Screen' : 'Ready to Share'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Mode</p>
                  <p className="text-sm text-white">View Only (Web)</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Viewers</p>
                  <p className="text-sm text-white">{viewerCount} connected</p>
                </div>
              </div>
            </div>

            {/* How to join */}
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Users className="h-4 w-4" />
                Invite Viewers
              </h4>
              <ol className="mt-3 space-y-2 text-sm text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-white">
                    1
                  </span>
                  Share the join link or code
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-white">
                    2
                  </span>
                  Viewers open the link in their browser
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-medium text-white">
                    3
                  </span>
                  They&apos;ll see your screen instantly
                </li>
              </ol>
            </div>

            {/* Limitations note */}
            <div className="mt-4 rounded-lg border border-yellow-900/50 bg-yellow-900/20 p-3">
              <p className="text-xs text-yellow-400">
                <strong>Note:</strong> Web hosting is view-only. For remote control features, use
                the{' '}
                <Link href="/download" className="underline hover:text-yellow-300">
                  desktop app
                </Link>
                .
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
