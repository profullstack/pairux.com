'use client';

import { useState, useEffect, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  Copy,
  Check,
  LogOut,
  Loader2,
  AlertCircle,
  Share2,
  Eye,
  MessageSquare,
  Circle,
  Pause,
  Play,
  StopCircle,
  Download,
} from 'lucide-react';
import { VideoPreview } from '@/components/video';
import { ParticipantList } from '@/components/chat/ParticipantList';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useScreenCapture, type CaptureQuality } from '@/hooks/useScreenCapture';
import { useRecording, formatDuration, type RecordingQuality } from '@/hooks/useRecording';
import { useWebRTCHost } from '@/hooks/useWebRTCHost';
import type { SessionParticipant } from '@pairux/shared-types';
import { Logo } from '@/components/Logo';

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
  session_participants?: SessionParticipant[];
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export default function HostSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [captureQuality, setCaptureQuality] = useState<CaptureQuality>('1080p');
  const [recordingQuality, setRecordingQuality] = useState<RecordingQuality>('1080p');
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);

  // Screen capture hook
  const {
    stream,
    captureState,
    error: captureError,
    startCapture,
    stopCapture,
  } = useScreenCapture();

  // Recording hook
  const {
    isRecording,
    isPaused,
    duration,
    error: recordingError,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    downloadRecording,
  } = useRecording({
    onStop: (blob) => {
      setRecordingBlob(blob);
    },
  });

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
    if (isRecording) {
      stopRecording();
    }
    stopCapture();
    stopHosting();
  }, [isRecording, stopRecording, stopCapture, stopHosting]);

  // Handle start recording
  const handleStartRecording = useCallback(() => {
    if (!stream) return;
    setRecordingBlob(null);
    startRecording(stream, { quality: recordingQuality });
  }, [stream, recordingQuality, startRecording]);

  // Handle stop recording
  const handleStopRecording = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  // Handle toggle pause
  const handleTogglePause = useCallback(() => {
    if (isPaused) {
      resumeRecording();
    } else {
      pauseRecording();
    }
  }, [isPaused, pauseRecording, resumeRecording]);

  // Handle download recording
  const handleDownloadRecording = useCallback(() => {
    if (recordingBlob) {
      downloadRecording(recordingBlob);
      setRecordingBlob(null);
    }
  }, [recordingBlob, downloadRecording]);

  // Handle start capture with quality
  const handleStartCapture = useCallback(() => {
    void startCapture({ quality: captureQuality });
  }, [startCapture, captureQuality]);

  // Handle end session
  const handleEndSession = useCallback(async () => {
    if (!session || isEnding) return;

    setIsEnding(true);
    try {
      stopCapture();
      stopHosting();

      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        console.error('Failed to end session');
      }

      router.push('/');
    } catch (err) {
      console.error('Error ending session:', err);
      router.push('/');
    }
  }, [session, sessionId, isEnding, stopCapture, stopHosting, router]);

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
              <Logo size="sm" variant="light" />
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

  const displayError = captureError ?? hostingError ?? recordingError;

  return (
    <div className="flex min-h-screen flex-col bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo size="sm" variant="light" />
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-xs font-medium text-green-400">
                  Hosting
                </span>
                {captureState !== 'active' && (
                  <span className="text-sm text-gray-500">(View Only)</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Recording controls */}
              {captureState === 'active' && (
                <div className="flex items-center gap-1 rounded-lg bg-gray-800 px-2 py-1">
                  {!isRecording ? (
                    <>
                      <select
                        value={recordingQuality}
                        onChange={(e) => {
                          setRecordingQuality(e.target.value as RecordingQuality);
                        }}
                        className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200"
                      >
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="4k">4K (where available)</option>
                      </select>
                      <button
                        type="button"
                        onClick={handleStartRecording}
                        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
                      >
                        <Circle className="h-3 w-3 fill-current" />
                        Record
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 px-2 font-mono text-xs text-gray-200">
                        <Circle className="h-2 w-2 animate-pulse fill-red-500 text-red-500" />
                        {formatDuration(duration)}
                      </span>
                      <button
                        type="button"
                        onClick={handleTogglePause}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700"
                        title={isPaused ? 'Resume' : 'Pause'}
                      >
                        {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={handleStopRecording}
                        className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
                      >
                        <StopCircle className="h-3 w-3" />
                        Stop
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Download recording button */}
              {recordingBlob && (
                <button
                  type="button"
                  onClick={handleDownloadRecording}
                  className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              )}

              {/* Chat toggle */}
              <button
                type="button"
                onClick={() => {
                  setShowChat(!showChat);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  showChat
                    ? 'bg-primary-600 text-white'
                    : 'border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Chat</span>
              </button>

              {/* Viewer count */}
              <div className="flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300">
                <Eye className="h-3.5 w-3.5" />
                {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
              </div>

              {/* End session button */}
              <button
                type="button"
                onClick={() => void handleEndSession()}
                disabled={isEnding || isRecording}
                title={isRecording ? 'Stop recording first' : undefined}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {isEnding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">End</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <main className="flex flex-1 flex-col">
          {/* Quality selection bar - show before capture starts */}
          {captureState === 'idle' && (
            <div className="border-b border-gray-800 bg-gray-900 px-4 py-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">Quality:</label>
                <select
                  value={captureQuality}
                  onChange={(e) => {
                    setCaptureQuality(e.target.value as CaptureQuality);
                  }}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
                >
                  <option value="720p">720p (HD)</option>
                  <option value="1080p">1080p (Full HD)</option>
                  <option value="4k">4K (where available)</option>
                </select>
                <span className="text-xs text-gray-500">Higher quality uses more bandwidth</span>
              </div>
            </div>
          )}

          <VideoPreview
            stream={stream}
            captureState={captureState}
            error={displayError}
            onStartCapture={handleStartCapture}
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
          <div className="flex h-full flex-col">
            {/* Participants section */}
            {session.session_participants && session.session_participants.length > 0 && (
              <div className="border-b border-gray-800">
                <ParticipantList
                  participants={session.session_participants.filter((p) => !p.left_at)}
                  currentUserId={session.host_user_id}
                  defaultExpanded={true}
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
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
          </div>
        </aside>

        {/* Chat panel */}
        {showChat && (
          <ChatPanel
            sessionId={session.id}
            participantId={session.host_user_id}
            isCollapsed={false}
            onToggleCollapse={() => {
              setShowChat(false);
            }}
            className="border-l border-gray-800 bg-gray-900"
          />
        )}
      </div>
    </div>
  );
}
