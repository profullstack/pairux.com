import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  StopCircle,
  Monitor,
  AppWindow,
  Share2,
  Copy,
  Check,
  Users,
  Loader2,
  MessageSquare,
  Circle,
  Pause,
  Play,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react';
import type { CaptureSource, Session } from '@pairux/shared-types';
import { APP_URL } from '../../../shared/config';
import { ChatPanel } from '@/components/chat';
import { ParticipantList } from '@/components/ParticipantList';
import { useSession } from '@/hooks/useSession';
import { useRecording, formatDuration, type RecordingQuality } from '@/hooks/useRecording';
import {
  SharingIndicator,
  RecordingIndicator,
  ControlActiveIndicator,
  RemoteCursorsContainer,
  useRemoteCursors,
} from '@/components/overlay';

interface CapturePreviewProps {
  stream: MediaStream;
  source: CaptureSource | null;
  onStop: () => void;
  currentUserId?: string;
  initialSession?: Session | null;
}

export function CapturePreview({
  stream,
  source,
  onStop,
  currentUserId,
  initialSession,
}: CapturePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);
  const [recordingQuality, setRecordingQuality] = useState<RecordingQuality>(() => {
    const saved = localStorage.getItem('pairux-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { recording?: { defaultQuality?: RecordingQuality } };
        return parsed.recording?.defaultQuality ?? '1080p';
      } catch {
        return '1080p';
      }
    }
    return '1080p';
  });
  const [includeAudio, setIncludeAudio] = useState(true);
  const [spaceWarning, setSpaceWarning] = useState<number | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  const {
    session: createdSession,
    participants,
    isCreating,
    isEnding,
    error,
    createSession,
    endSession,
    setSession,
  } = useSession();

  const {
    isRecording,
    isPaused,
    duration,
    path: _recordingPath,
    error: recordingError,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    openRecordingsFolder,
  } = useRecording({
    onStart: (path) => {
      console.log('[CapturePreview] Recording started:', path);
    },
    onStop: (path, dur) => {
      console.log('[CapturePreview] Recording stopped:', path, `Duration: ${String(dur)}s`);
    },
    onError: (err) => {
      console.error('[CapturePreview] Recording error:', err);
    },
    onSpaceWarning: (gb) => {
      setSpaceWarning(gb);
    },
  });

  // Use initialSession if provided, otherwise use created session
  const session = initialSession ?? createdSession;

  // Remote cursors for showing viewer cursor positions
  const { cursors: remoteCursors } = useRemoteCursors();

  // Find participant with control granted
  const participantWithControl = useMemo(() => {
    return participants.find((p) => p.control_state === 'granted' && !p.left_at) ?? null;
  }, [participants]);

  // Get source dimensions for cursor scaling
  const sourceDimensions = useMemo(() => {
    const tracks = stream.getVideoTracks();
    const track = tracks.length > 0 ? tracks[0] : undefined;
    const settings = track?.getSettings();
    return {
      width: settings?.width ?? 1920,
      height: settings?.height ?? 1080,
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
    }

    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  // Track container dimensions for cursor scaling
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      setContainerDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Set initial session if provided
  useEffect(() => {
    if (initialSession) {
      setSession(initialSession);
    }
  }, [initialSession, setSession]);

  // Auto-create session when capture starts (only if no initial session)
  useEffect(() => {
    if (!initialSession && !createdSession && !isCreating) {
      void createSession({ allowGuestControl: false, maxParticipants: 5 });
    }
  }, [initialSession, createdSession, isCreating, createSession]);

  const handleStop = useCallback(async () => {
    if (session) {
      await endSession();
    }
    onStop();
  }, [session, endSession, onStop]);

  const handleCopyLink = useCallback(async () => {
    if (!session) return;

    const joinUrl = `${APP_URL}/join/${session.join_code}`;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [session]);

  // Participant management actions
  const handleGrantControl = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${APP_URL}/api/sessions/${session.id}/participants/${participantId}/control`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ control_state: 'granted' }),
          }
        );
        if (!response.ok) {
          console.error('Failed to grant control');
        }
      } catch (err) {
        console.error('Error granting control:', err);
      }
    },
    [session]
  );

  const handleRevokeControl = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${APP_URL}/api/sessions/${session.id}/participants/${participantId}/control`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ control_state: 'view-only' }),
          }
        );
        if (!response.ok) {
          console.error('Failed to revoke control');
        }
      } catch (err) {
        console.error('Error revoking control:', err);
      }
    },
    [session]
  );

  const handleKickParticipant = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${APP_URL}/api/sessions/${session.id}/participants/${participantId}`,
          {
            method: 'DELETE',
          }
        );
        if (!response.ok) {
          console.error('Failed to kick participant');
        }
      } catch (err) {
        console.error('Error kicking participant:', err);
      }
    },
    [session]
  );

  const handleStartRecording = useCallback(async () => {
    if (!source) return;
    setSpaceWarning(null);
    await startRecording(source.id, {
      quality: recordingQuality,
      format: 'webm',
      includeAudio,
      // Pass the existing stream so we don't need to create a new one
      // This is especially important for Wayland where the source ID isn't a valid chromeMediaSourceId
      existingStream: stream,
    });
  }, [source, recordingQuality, includeAudio, startRecording, stream]);

  const handleStopRecording = useCallback(async () => {
    await stopRecording();
    setSpaceWarning(null);
  }, [stopRecording]);

  const handleTogglePause = useCallback(async () => {
    if (isPaused) {
      await resumeRecording();
    } else {
      await pauseRecording();
    }
  }, [isPaused, pauseRecording, resumeRecording]);

  const isScreen = source?.type === 'screen';
  const activeParticipants = participants.filter((p) => !p.left_at);

  return (
    <div className="flex flex-1">
      {/* Main content */}
      <div className="flex flex-1 flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isScreen ? (
              <Monitor className="h-5 w-5 text-primary" />
            ) : (
              <AppWindow className="h-5 w-5 text-primary" />
            )}
            <div>
              <h2 className="text-lg font-semibold">{source?.name ?? 'Capturing'}</h2>
              <p className="text-sm text-muted-foreground">
                {isScreen ? 'Screen' : 'Window'} capture active
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Participants toggle */}
            <button
              onClick={() => {
                setShowParticipants(!showParticipants);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                showParticipants
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Users className="h-4 w-4" />
              Participants
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

            {/* Recording controls */}
            <div className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1">
              {!isRecording ? (
                <>
                  <select
                    value={recordingQuality}
                    onChange={(e) => {
                      setRecordingQuality(e.target.value as RecordingQuality);
                    }}
                    className="rounded bg-background px-2 py-1 text-xs"
                    title="Recording quality - affects file size and bitrate"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="4k">4K</option>
                  </select>
                  <button
                    onClick={() => {
                      setIncludeAudio(!includeAudio);
                    }}
                    className={`rounded px-2 py-1 text-xs ${
                      includeAudio ? 'bg-primary text-primary-foreground' : 'bg-background'
                    }`}
                    title={includeAudio ? 'Audio enabled' : 'Audio disabled'}
                  >
                    {includeAudio ? '🔊' : '🔇'}
                  </button>
                  <button
                    onClick={() => void handleStartRecording()}
                    className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                    title="Start recording to local file"
                  >
                    <Circle className="h-3 w-3 fill-current" />
                    Record
                  </button>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 px-2 font-mono text-sm">
                    <Circle className="h-2 w-2 animate-pulse fill-red-500 text-red-500" />
                    {formatDuration(duration)}
                  </span>
                  <button
                    onClick={() => void handleTogglePause()}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background"
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => void handleStopRecording()}
                    className="flex items-center gap-1.5 rounded-md bg-muted-foreground/20 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted-foreground/30"
                  >
                    <StopCircle className="h-3 w-3" />
                    Stop
                  </button>
                  <button
                    onClick={() => void openRecordingsFolder()}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background"
                    title="Open recordings folder"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            {/* Stop sharing button */}
            <button
              onClick={() => void handleStop()}
              disabled={isEnding || isRecording}
              className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              title={isRecording ? 'Stop recording first' : undefined}
            >
              {isEnding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4" />
              )}
              Stop Sharing
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Recording error */}
        {recordingError && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Recording error: {recordingError}
          </div>
        )}

        {/* Space warning */}
        {spaceWarning !== null && (
          <div className="flex items-center gap-2 rounded-lg bg-yellow-500/10 px-4 py-3 text-sm text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4" />
            Low disk space: {spaceWarning.toFixed(1)} GB remaining
          </div>
        )}

        {/* Session info bar */}
        {session ? (
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-sm font-medium">{session.join_code}</span>
              </div>

              <button
                onClick={() => void handleCopyLink()}
                className="flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-background/80"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy Link
                  </>
                )}
              </button>

              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {activeParticipants.length} viewer{activeParticipants.length !== 1 ? 's' : ''}
              </div>
            </div>

            <span className="font-mono text-sm text-muted-foreground">
              {stream.getVideoTracks()[0]?.getSettings().width ?? 0} x{' '}
              {stream.getVideoTracks()[0]?.getSettings().height ?? 0}
            </span>
          </div>
        ) : isCreating ? (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating session...
          </div>
        ) : null}

        {/* Video preview */}
        <div
          ref={videoContainerRef}
          className="relative flex-1 overflow-hidden rounded-lg border border-border bg-black"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />

          {/* Live/Preview indicator */}
          <div className="absolute left-4 top-4 flex flex-col gap-2">
            <SharingIndicator isLive={!!session} />
            {/* Control Active indicator */}
            {participantWithControl && (
              <ControlActiveIndicator participant={participantWithControl} />
            )}
          </div>

          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute right-4 top-4">
              <RecordingIndicator isPaused={isPaused} duration={duration} />
            </div>
          )}

          {/* Remote cursors */}
          <RemoteCursorsContainer
            cursors={remoteCursors}
            containerDimensions={containerDimensions}
            sourceDimensions={sourceDimensions}
          />
        </div>
      </div>

      {/* Participants panel */}
      {session && showParticipants && (
        <div className="w-72 shrink-0 border-l border-border bg-background p-4">
          <ParticipantList
            participants={participants}
            currentUserId={currentUserId}
            sessionId={session.id}
            isHost={true}
            onGrantControl={handleGrantControl}
            onRevokeControl={handleRevokeControl}
            onKickParticipant={handleKickParticipant}
          />
        </div>
      )}

      {/* Chat panel */}
      {session && showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={currentUserId}
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
