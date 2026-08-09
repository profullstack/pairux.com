import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Users,
  Loader2,
  LogOut,
  MessageSquare,
  AlertCircle,
  Share2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ChatPanel } from '@/components/chat';
import { VideoViewer } from '@/components/video/VideoViewer';
import { ControlRequestButton } from '@/components/control/ControlRequestButton';
import { InputCapture } from '@/components/control/InputCapture';
import { useAuthStore } from '@/stores/auth';
import { getElectronAPI } from '@/lib/ipc';
import { useWebRTCViewerAPI } from '@/hooks/useWebRTCViewerAPI';
import { useWebRTCViewerSFUAPI } from '@/hooks/useWebRTCViewerSFUAPI';
import type {
  Session,
  SessionParticipant,
  ConnectionState,
  ControlStateUI,
  InputEvent,
} from '@pairux/shared-types';
import { playJoinSound, playLeaveSound, useSessionSoundsEnabled } from '@/lib/sessionSounds';

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
  sendInput: (event: InputEvent) => void;
  sendCursorPosition: (x: number, y: number, visible: boolean) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

const PARTICIPANT_REFRESH_DEBOUNCE_MS = 250;

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lastParticipantRefreshAt, setLastParticipantRefreshAt] = useState(0);

  // Chime when someone else arrives or leaves.
  //
  // Derived by diffing the participant list rather than from an event, because
  // presence only tells us *that* it changed. The first list to arrive seeds
  // the baseline silently — everyone already in the room when we walked in is
  // not an arrival.
  const sessionSoundsEnabled = useSessionSoundsEnabled();
  const knownParticipantsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const current = new Set(participants.map((participant) => participant.id));
    const known = knownParticipantsRef.current;
    knownParticipantsRef.current = current;

    if (known === null) return;
    if (!sessionSoundsEnabled) return;

    const arrived = [...current].some((id) => !known.has(id));
    const departed = [...known].some((id) => !current.has(id));

    // One chime per change, even when several people move at once: a burst of
    // overlapping tones reads as a glitch rather than as a count.
    if (arrived) playJoinSound();
    else if (departed) playLeaveSound();
  }, [participants, sessionSoundsEnabled]);

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

  const refreshParticipantsNow = useCallback(async () => {
    if (!sessionId) return;
    const now = Date.now();
    if (now - lastParticipantRefreshAt < PARTICIPANT_REFRESH_DEBOUNCE_MS) {
      return;
    }
    setLastParticipantRefreshAt(now);
    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:get', { sessionId });
      if (!result.success) return;
      setParticipants(result.participants);
      setSession(result.session);
    } catch {
      // Non-fatal: polling fallback will catch up
    }
  }, [sessionId, lastParticipantRefreshAt]);

  const handlePresenceChange = useCallback(() => {
    void refreshParticipantsNow();
  }, [refreshParticipantsNow]);

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

  // Signaling IDs use auth user IDs (presence + sender/target IDs), not session_participants IDs.
  const participantId = user.id;

  // Branch on session mode
  if (session.mode === 'sfu') {
    return (
      <SFUViewer
        session={session}
        sessionId={sessionId}
        participantId={participantId}
        participants={participants}
        userId={user.id}
        onPresenceChange={handlePresenceChange}
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
      onPresenceChange={handlePresenceChange}
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
  onPresenceChange: () => void;
}

function P2PViewer({
  session,
  sessionId,
  participantId,
  participants,
  userId,
  onPresenceChange,
}: ViewerWrapperProps) {
  const navigate = useNavigate();

  const hookResult = useWebRTCViewerAPI({
    sessionId,
    participantId,
    onKicked: () => {
      void navigate('/join');
    },
    onPresenceChange,
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
  onPresenceChange,
}: ViewerWrapperProps) {
  const navigate = useNavigate();

  const hookResult = useWebRTCViewerSFUAPI({
    sessionId,
    participantId,
    onKicked: () => {
      void navigate('/join');
    },
    onPresenceChange,
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
  const [speakerMuted, setSpeakerMuted] = useState(false);

  const {
    connectionState,
    remoteStream,
    error: webrtcError,
    reconnect,
    disconnect,
    controlState,
    dataChannelReady,
    requestControl,
    releaseControl,
    sendInput,
    sendCursorPosition,
    micEnabled,
    hasMic,
    toggleMic,
  } = hookResult;

  // Whether the host allows guests to ask for control at all. Fixed when the
  // session was created, so sessions made before it defaulted on stay off.
  const allowControl = session.settings.allowControl ?? false;

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
            {allowControl && (
              <ControlRequestButton
                controlState={controlState}
                dataChannelReady={dataChannelReady}
                onRequestControl={requestControl}
                onReleaseControl={releaseControl}
              />
            )}

            <button
              onClick={() => {
                void navigate(`/?shareSessionId=${session.id}`);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              title="Share your screen in this session"
            >
              <Share2 className="h-4 w-4" />
              Share Screen
            </button>

            <button
              onClick={() => {
                setSpeakerMuted((prev) => !prev);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                speakerMuted
                  ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                  : 'bg-blue-700 text-white hover:bg-blue-600'
              }`}
              title={speakerMuted ? 'Turn speaker on' : 'Turn speaker off'}
            >
              {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {speakerMuted ? 'Speaker Off' : 'Speaker On'}
            </button>

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

        {/* Video viewer, wrapped so mouse/keyboard can be forwarded to the
            host once control is granted. */}
        <InputCapture
          enabled={allowControl}
          controlState={controlState}
          onInputEvent={sendInput}
          onCursorMove={sendCursorPosition}
          className="flex flex-1 flex-col"
        >
          <VideoViewer
            stream={remoteStream}
            connectionState={connectionState}
            error={webrtcError}
            onReconnect={reconnect}
            speakerMuted={speakerMuted}
            onSpeakerMutedChange={setSpeakerMuted}
            showSpeakerToggle={false}
            className="flex-1"
          />
        </InputCapture>
      </div>

      {/* Chat panel */}
      {showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={userId}
          participants={activeParticipants}
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
