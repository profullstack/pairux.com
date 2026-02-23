'use client';

import { useState, useEffect, use, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Loader2,
  AlertCircle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { HostPresenceIndicator } from '@/components/session/HostPresenceIndicator';
import { useSessionPresence } from '@/hooks/useSessionPresence';
import type {
  ConnectionState,
  CursorPositionMessage,
  QualityMetrics,
  NetworkQuality,
  ControlStateUI,
  InputEvent,
} from '@pairux/shared-types';
import { VideoViewer } from '@/components/video';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useWebRTCSFU } from '@/hooks/useWebRTCSFU';
import {
  ControlRequestButton,
  ControlStatusIndicator,
  InputCapture,
  CursorOverlay,
} from '@/components/control';
import { Logo } from '@/components/Logo';

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
  mode?: 'p2p' | 'sfu';
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  created_at: string;
  session_participants: Participant[];
}

interface GuestSessionResponse {
  session: SessionData;
  participant: Participant;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export default function GuestSessionViewerPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const searchParams = useSearchParams();
  const participantId = searchParams.get('p');

  const [session, setSession] = useState<SessionData | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchGuestSession() {
      if (!participantId) {
        setError('Invalid session link. Missing participant ID.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/sessions/${sessionId}/guest?p=${participantId}`);
        const data = (await res.json()) as ApiResponse<GuestSessionResponse>;

        if (!res.ok) {
          setError(data.error ?? 'Session not found or access denied');
          return;
        }

        if (data.data) {
          setSession(data.data.session);
          setParticipant(data.data.participant);
        }
      } catch {
        setError('Failed to load session');
      } finally {
        setLoading(false);
      }
    }

    void fetchGuestSession();
  }, [sessionId, participantId]);

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

  if (error || !session || !participant || !participantId) {
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
            <h1 className="mt-4 text-xl font-semibold text-white">Access Denied</h1>
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

  // Branch on session mode — render separate components so each can call its own hook
  if (session.mode === 'sfu') {
    return (
      <SFUGuestViewer
        sessionId={sessionId}
        session={session}
        participant={participant}
        participantId={participantId}
      />
    );
  }

  return (
    <P2PGuestViewer
      sessionId={sessionId}
      session={session}
      participant={participant}
      participantId={participantId}
    />
  );
}

// --- Mode-specific wrapper components (each calls its own hook) ---

interface GuestViewerProps {
  sessionId: string;
  session: SessionData;
  participant: Participant;
  participantId: string;
}

function P2PGuestViewer({ sessionId, session, participant, participantId }: GuestViewerProps) {
  const [remoteCursors, setRemoteCursors] = useState<Map<string, CursorPositionMessage>>(new Map());

  const handleCursorUpdate = useCallback((cursor: CursorPositionMessage) => {
    setRemoteCursors((prev) => {
      const next = new Map(prev);
      if (cursor.visible) {
        next.set(cursor.participantId, cursor);
      } else {
        next.delete(cursor.participantId);
      }
      return next;
    });
  }, []);

  const hookResult = useWebRTC({
    sessionId,
    participantId,
    onCursorUpdate: handleCursorUpdate,
  });

  return (
    <GuestViewerContent
      session={session}
      participant={participant}
      remoteCursors={remoteCursors}
      {...hookResult}
    />
  );
}

function SFUGuestViewer({ sessionId, session, participant, participantId }: GuestViewerProps) {
  const [remoteCursors, setRemoteCursors] = useState<Map<string, CursorPositionMessage>>(new Map());

  const handleCursorUpdate = useCallback((cursor: CursorPositionMessage) => {
    setRemoteCursors((prev) => {
      const next = new Map(prev);
      if (cursor.visible) {
        next.set(cursor.participantId, cursor);
      } else {
        next.delete(cursor.participantId);
      }
      return next;
    });
  }, []);

  const hookResult = useWebRTCSFU({
    sessionId,
    participantId,
    onCursorUpdate: handleCursorUpdate,
  });

  return (
    <GuestViewerContent
      session={session}
      participant={participant}
      remoteCursors={remoteCursors}
      {...hookResult}
    />
  );
}

// --- Shared viewer content (all JSX lives here) ---

interface GuestViewerContentProps {
  session: SessionData;
  participant: Participant;
  remoteCursors: Map<string, CursorPositionMessage>;
  connectionState: ConnectionState;
  remoteStream: MediaStream | null;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  error: string | null;
  reconnect: () => void;
  controlState: ControlStateUI;
  dataChannelReady: boolean;
  requestControl: () => void;
  releaseControl: () => void;
  sendInput: (event: InputEvent) => void;
  sendCursorPosition: (x: number, y: number, visible: boolean) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

function GuestViewerContent({
  session,
  participant,
  remoteCursors,
  connectionState,
  remoteStream,
  qualityMetrics,
  networkQuality,
  error: webrtcError,
  reconnect,
  controlState,
  dataChannelReady,
  requestControl,
  releaseControl,
  sendInput,
  sendCursorPosition,
  micEnabled,
  hasMic,
  toggleMic,
}: GuestViewerContentProps) {
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const allowControl = session.settings.allowControl ?? false;
  const activeParticipants = session.session_participants.filter((p) => p.role !== 'left');

  // Track host presence in real-time
  const { status: sessionStatus, currentHostId, hostOnline } = useSessionPresence(session.id);
  const prevHostOnline = useRef(hostOnline);

  // Auto-reconnect when host returns
  useEffect(() => {
    if (hostOnline && !prevHostOnline.current) {
      reconnect();
    }
    prevHostOnline.current = hostOnline;
  }, [hostOnline, reconnect]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo size="sm" variant="light" />
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-sm text-gray-500">Session</span>
                <span className="font-mono text-sm font-semibold text-white">
                  {session.join_code}
                </span>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-xs text-gray-500">Viewing as</span>
                <span className="rounded bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-300">
                  {participant.display_name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <ConnectionStatusBadge connectionState={connectionState} />
              {allowControl && <ControlStatusIndicator controlState={controlState} />}
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
          <div ref={videoContainerRef} className="relative flex-1 bg-black">
            {!hostOnline && (
              <HostPresenceIndicator sessionStatus={sessionStatus} currentHostId={currentHostId} />
            )}
            <InputCapture
              enabled={allowControl}
              controlState={controlState}
              onInputEvent={sendInput}
              onCursorMove={sendCursorPosition}
              className="h-full"
            >
              <VideoViewer
                stream={remoteStream}
                connectionState={connectionState}
                qualityMetrics={qualityMetrics}
                networkQuality={networkQuality}
                error={webrtcError}
                onReconnect={reconnect}
                speakerMuted={speakerMuted}
                onSpeakerMutedChange={setSpeakerMuted}
                showSpeakerToggle={false}
                className="h-full"
              />
            </InputCapture>
            <CursorOverlay cursors={remoteCursors} />
          </div>

          {/* Control bar */}
          <div className="flex items-center justify-center gap-4 border-t border-gray-800 bg-gray-900 px-4 py-3">
            {allowControl && (
              <ControlRequestButton
                controlState={controlState}
                dataChannelReady={dataChannelReady}
                onRequestControl={requestControl}
                onReleaseControl={releaseControl}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setSpeakerMuted((prev) => !prev);
              }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                speakerMuted
                  ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  : 'bg-blue-700 text-white hover:bg-blue-600'
              }`}
              title={speakerMuted ? 'Turn speaker on' : 'Turn speaker off'}
            >
              {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {speakerMuted ? 'Speaker Off' : 'Speaker On'}
            </button>
            <button
              type="button"
              onClick={toggleMic}
              disabled={!hasMic}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                micEnabled
                  ? 'bg-green-700 text-white hover:bg-green-600'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              } disabled:opacity-50`}
              title={!hasMic ? 'No microphone available' : micEnabled ? 'Mute' : 'Unmute'}
            >
              {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {micEnabled ? 'Mic On' : 'Mic Off'}
            </button>
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
              {activeParticipants.map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                    p.id === participant.id
                      ? 'bg-primary-900/30 ring-primary-500/50 ring-1'
                      : 'bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="bg-primary-600 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white">
                      {p.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {p.display_name}
                        {p.id === participant.id && (
                          <span className="ml-1 text-xs text-gray-400">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">{p.role}</p>
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

function ConnectionStatusBadge({ connectionState }: { connectionState: ConnectionState }) {
  const config: Record<
    ConnectionState,
    { bg: string; text: string; icon: typeof Wifi; label: string }
  > = {
    idle: { bg: 'bg-gray-700/50', text: 'text-gray-400', icon: WifiOff, label: 'Waiting' },
    connecting: {
      bg: 'bg-blue-900/50',
      text: 'text-blue-400',
      icon: RefreshCw,
      label: 'Connecting',
    },
    connected: { bg: 'bg-green-900/50', text: 'text-green-400', icon: Wifi, label: 'Connected' },
    reconnecting: {
      bg: 'bg-yellow-900/50',
      text: 'text-yellow-400',
      icon: RefreshCw,
      label: 'Reconnecting',
    },
    failed: { bg: 'bg-red-900/50', text: 'text-red-400', icon: WifiOff, label: 'Failed' },
    disconnected: {
      bg: 'bg-gray-700/50',
      text: 'text-gray-400',
      icon: WifiOff,
      label: 'Disconnected',
    },
  };

  const { bg, text, icon: Icon, label } = config[connectionState];
  const isAnimating = connectionState === 'connecting' || connectionState === 'reconnecting';

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${bg} ${text}`}
    >
      <Icon className={`h-3 w-3 ${isAnimating ? 'animate-spin' : ''}`} />
      {label}
    </div>
  );
}
