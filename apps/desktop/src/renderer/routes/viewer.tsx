import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Loader2, LogOut, MessageSquare, AlertCircle, Mic, MicOff } from 'lucide-react';
import { ChatPanel } from '@/components/chat';
import { VideoViewer } from '@/components/video/VideoViewer';
import { useAuthStore } from '@/stores/auth';
import { getElectronAPI } from '@/lib/ipc';
import { useWebRTCViewerAPI } from '@/hooks/useWebRTCViewerAPI';
import { useWebRTCViewerSFUAPI } from '@/hooks/useWebRTCViewerSFUAPI';
import type {
  Session,
  SessionParticipant,
  ConnectionState,
  ControlStateUI,
} from '@pairux/shared-types';

// Common return type for both viewer hooks
interface ViewerHookResult {
  connectionState: ConnectionState;
  remoteStream: MediaStream | null;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
  controlState: ControlStateUI;
  dataChannelReady: boolean;
  requestControl: () => void;
  releaseControl: () => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!sessionId) {
      void navigate('/join');
      return;
    }

    const loadSession = async () => {
      try {
        const api = getElectronAPI();
        const result = await api.invoke('session:get', { sessionId });

        if (!result.success) {
          setLoadError(result.error);
          return;
        }

        setSession(result.session);
        setParticipants(result.participants);
      } catch {
        setLoadError('Failed to load session');
      } finally {
        setLoading(false);
      }
    };

    void loadSession();

    // Poll for participant updates every 5 seconds
    const interval = setInterval(() => {
      void loadSession();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [sessionId, navigate]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  if (loadError && !session) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Session Error</h2>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <button
            onClick={() => void navigate('/join')}
            className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Join
          </button>
        </div>
      </div>
    );
  }

  if (!session || !sessionId || !user) {
    return null;
  }

  // Find this user's participant entry
  const myParticipant = participants.find((p) => p.user_id === user.id && p.role === 'viewer');
  const participantId = myParticipant?.id ?? user.id;

  // Branch on session mode
  if (session.mode === 'sfu') {
    return (
      <SFUViewer
        session={session}
        sessionId={sessionId}
        participantId={participantId}
        participants={participants}
        userId={user.id}
      />
    );
  }

  return (
    <P2PViewer
      session={session}
      sessionId={sessionId}
      participantId={participantId}
      participants={participants}
      userId={user.id}
    />
  );
}

// --- Mode-specific wrapper components ---

interface ViewerWrapperProps {
  session: Session;
  sessionId: string;
  participantId: string;
  participants: SessionParticipant[];
  userId: string;
}

function P2PViewer({
  session,
  sessionId,
  participantId,
  participants,
  userId,
}: ViewerWrapperProps) {
  const navigate = useNavigate();

  const hookResult = useWebRTCViewerAPI({
    sessionId,
    participantId,
    onKicked: () => {
      void navigate('/join');
    },
  });

  return (
    <ViewerContent
      session={session}
      participants={participants}
      userId={userId}
      hookResult={hookResult}
    />
  );
}

function SFUViewer({
  session,
  sessionId,
  participantId,
  participants,
  userId,
}: ViewerWrapperProps) {
  const navigate = useNavigate();

  const hookResult = useWebRTCViewerSFUAPI({
    sessionId,
    participantId,
    onKicked: () => {
      void navigate('/join');
    },
  });

  return (
    <ViewerContent
      session={session}
      participants={participants}
      userId={userId}
      hookResult={hookResult}
    />
  );
}

// --- Shared viewer content ---

interface ViewerContentProps {
  session: Session;
  participants: SessionParticipant[];
  userId: string;
  hookResult: ViewerHookResult;
}

function ViewerContent({ session, participants, userId, hookResult }: ViewerContentProps) {
  const navigate = useNavigate();
  const [showChat, setShowChat] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const {
    connectionState,
    remoteStream,
    error: webrtcError,
    reconnect,
    disconnect,
    micEnabled,
    hasMic,
    toggleMic,
  } = hookResult;

  const handleLeave = useCallback(() => {
    setLeaving(true);
    disconnect();
    void navigate('/join');
  }, [disconnect, navigate]);

  const activeParticipants = participants.filter((p) => !p.left_at);
  const host = participants.find((p) => p.role === 'host');

  return (
    <div className="flex flex-1">
      {/* Main content */}
      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold">Viewing Session</h2>
              <p className="text-sm text-muted-foreground">
                Hosted by {host?.display_name ?? 'Unknown'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mic toggle */}
            <button
              onClick={toggleMic}
              disabled={!hasMic}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                micEnabled
                  ? 'bg-green-700 text-white hover:bg-green-600'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              } disabled:opacity-50`}
              title={!hasMic ? 'No microphone available' : micEnabled ? 'Mute' : 'Unmute'}
            >
              {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {micEnabled ? 'Mic On' : 'Mic Off'}
            </button>

            {/* Chat toggle */}
            <button
              onClick={() => {
                setShowChat(!showChat);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                showChat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </button>

            {/* Leave button */}
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {leaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Leave Session
            </button>
          </div>
        </div>

        {/* WebRTC error message */}
        {webrtcError && connectionState !== 'failed' && connectionState !== 'disconnected' && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {webrtcError}
          </div>
        )}

        {/* Session info bar */}
        <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{session.join_code}</span>
            </div>

            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              {activeParticipants.length} participant
              {activeParticipants.length !== 1 ? 's' : ''}
            </div>

            <span className="text-xs text-muted-foreground">
              {session.mode === 'sfu' ? 'SFU' : 'P2P'}
            </span>
          </div>

          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              session.status === 'active'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-yellow-500/10 text-yellow-500'
            }`}
          >
            {session.status.toUpperCase()}
          </span>
        </div>

        {/* Video viewer */}
        <VideoViewer
          stream={remoteStream}
          connectionState={connectionState}
          error={webrtcError}
          onReconnect={reconnect}
          className="flex-1"
        />
      </div>

      {/* Chat panel */}
      {showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={userId}
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
