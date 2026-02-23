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
  Volume2,
  VolumeX,
  Mic,
  MicOff,
} from 'lucide-react';
import type {
  CaptureSource,
  Session,
  InputMessage,
  CursorPositionMessage,
} from '@pairux/shared-types';
import { APP_URL, API_BASE_URL } from '../../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/chat';
import { ParticipantList } from '@/components/ParticipantList';
import { StreamControls, StreamIndicator } from '@/components/streaming';
import { useSession } from '@/hooks/useSession';
import { useRecording, formatDuration, type RecordingQuality } from '@/hooks/useRecording';
import { useRTMPStreaming } from '@/hooks/useRTMPStreaming';
import { useWebRTCHostAPI } from '@/hooks/useWebRTCHostAPI';
import { useWebRTCHostSFUAPI } from '@/hooks/useWebRTCHostSFUAPI';
import { useAudioMixer } from '@/hooks/useAudioMixer';
import {
  SharingIndicator,
  RecordingIndicator,
  ControlActiveIndicator,
  RemoteCursorsContainer,
  useRemoteCursors,
} from '@/components/overlay';

interface CapturePreviewProps {
  stream: MediaStream | null;
  source: CaptureSource | null;
  onStop: () => void;
  onStopCapture?: () => void;
  onStartCapture?: () => void;
  currentUserId?: string;
  initialSession?: Session | null;
}

export function CapturePreview({
  stream,
  source,
  onStop,
  onStopCapture,
  onStartCapture,
  currentUserId,
  initialSession,
}: CapturePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const authTokenRef = useRef<string | null>(null);

  // Fetch auth token once on mount for API calls
  useEffect(() => {
    const api = getElectronAPI();
    api
      .invoke('auth:getToken', undefined)
      .then(({ token }) => {
        authTokenRef.current = token;
      })
      .catch(() => {
        // Ignore - non-critical
      });
  }, []);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
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
  const [mutedParticipants, setMutedParticipants] = useState<Set<string>>(new Set());
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
    refreshSession,
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

  const {
    destinations,
    streamStatuses,
    isAnyStreaming,
    activeStreamCount,
    startStream,
    stopStream,
    startAllStreams,
    stopAllStreams,
  } = useRTMPStreaming({
    onStreamError: (destId, err) => {
      console.error(`[CapturePreview] Stream ${destId} error:`, err);
    },
  });

  // Use initialSession if provided, otherwise use created session
  const session = initialSession ?? createdSession;

  // Remote cursors for showing viewer cursor positions
  const { cursors: remoteCursors } = useRemoteCursors();

  // Determine mode once — do NOT conditionally call hooks
  const isSFU = initialSession?.mode === 'sfu';

  const hostHookOptions = useMemo(
    () => ({
      sessionId: session?.id ?? '',
      hostId: currentUserId ?? session?.id ?? '',
      localStream: stream,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      allowControl: Boolean(session?.settings?.allowControl),
      onViewerJoined: (viewerId: string) => {
        console.log('[CapturePreview] Viewer joined:', viewerId);
      },
      onViewerLeft: (viewerId: string) => {
        console.log('[CapturePreview] Viewer left:', viewerId);
      },
      onInputReceived: (_viewerId: string, _input: InputMessage) => {
        // TODO: Handle remote input injection
        console.log('[CapturePreview] Input received from viewer');
      },
      onCursorUpdate: (_viewerId: string, _cursor: CursorPositionMessage) => {
        // TODO: Update remote cursor position
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    [session?.id, currentUserId, stream, session?.settings?.allowControl]
  );

  // Always call both hooks (Rules of Hooks) — use results from the active one
  const p2pHost = useWebRTCHostAPI(hostHookOptions);
  const sfuHost = useWebRTCHostSFUAPI(hostHookOptions);

  // Pick the result based on mode
  const {
    isHosting,
    viewerCount,
    viewers: hostedViewers,
    error: hostingError,
    startHosting,
    stopHosting,
    publishStream: hostPublishStream,
    unpublishStream: hostUnpublishStream,
    grantControl,
    revokeControl,
    kickViewer,
    muteViewer,
    micEnabled: hostMicEnabled,
    hasMic: hostHasMic,
    toggleMic: hostToggleMic,
  } = isSFU ? sfuHost : p2pHost;

  // Audio mixer: combines host mic + all viewer audio into one stream for recording
  const {
    mixedStream,
    addTrack: mixerAddTrack,
    removeTrack: mixerRemoveTrack,
    setTrackMuted: mixerSetTrackMuted,
    dispose: disposeMixer,
  } = useAudioMixer();

  // Add host mic audio to the mixer
  useEffect(() => {
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      mixerAddTrack('host-mic', audioTracks[0], false);
    }
    return () => {
      mixerRemoveTrack('host-mic');
    };
  }, [stream, mixerAddTrack, mixerRemoveTrack]);

  // Sync viewer audio tracks into the mixer as viewers join/leave
  useEffect(() => {
    const currentViewerIds = new Set<string>();

    for (const [viewerId, viewer] of hostedViewers.entries()) {
      if (viewer.audioTrack) {
        currentViewerIds.add(viewerId);
        mixerAddTrack(viewerId, viewer.audioTrack, true);
        mixerSetTrackMuted(viewerId, viewer.isMuted);
      }
    }

    // On cleanup, remove all tracks that were added in this effect run.
    // This ensures tracks are cleaned up when viewers leave or the effect re-runs.
    return () => {
      for (const viewerId of currentViewerIds) {
        mixerRemoveTrack(viewerId);
      }
    };
  }, [hostedViewers, mixerAddTrack, mixerRemoveTrack, mixerSetTrackMuted]);

  // Clean up mixer when component unmounts
  useEffect(() => {
    return () => {
      disposeMixer();
    };
  }, [disposeMixer]);

  // Start hosting (voice channel) when session is available -- no stream required
  useEffect(() => {
    if (session !== null && !isHosting) {
      console.log('[CapturePreview] Starting WebRTC hosting for session:', session.id);
      void startHosting();
    }
  }, [session, isHosting, startHosting]);

  // Publish screen share stream when capture starts.
  // Use the mixer output when available so live WebRTC matches recording audio
  // behavior (host mic + any routed audio sources).
  useEffect(() => {
    if (stream && isHosting) {
      const publishStream = new MediaStream();

      stream.getVideoTracks().forEach((track) => {
        publishStream.addTrack(track);
      });

      const mixedAudioTracks = mixedStream?.getAudioTracks() ?? [];
      const fallbackAudioTracks = stream.getAudioTracks();
      const selectedAudioTracks =
        mixedAudioTracks.length > 0 ? mixedAudioTracks : fallbackAudioTracks;

      selectedAudioTracks.forEach((track) => {
        publishStream.addTrack(track);
      });

      console.log('[CapturePreview] Publishing live stream to viewers', {
        videoTracks: publishStream.getVideoTracks().length,
        audioTracks: publishStream.getAudioTracks().length,
        audioSource: mixedAudioTracks.length > 0 ? 'mixer' : 'capture-stream',
      });

      void hostPublishStream(publishStream);
    }
  }, [stream, mixedStream, isHosting, hostPublishStream]);

  // Unpublish screen share when capture stops (session stays alive)
  useEffect(() => {
    if (!stream && isHosting) {
      void hostUnpublishStream();
    }
  }, [stream, isHosting, hostUnpublishStream]);

  // Stop hosting when component unmounts
  useEffect(() => {
    return () => {
      if (isHosting) {
        stopHosting();
      }
    };
  }, [isHosting, stopHosting]);

  // Find participant with control granted
  const participantWithControl = useMemo(() => {
    return participants.find((p) => p.control_state === 'granted' && !p.left_at) ?? null;
  }, [participants]);

  // Get source dimensions for cursor scaling
  const sourceDimensions = useMemo(() => {
    if (!stream) return { width: 1920, height: 1080 };
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
    if (!initialSession && !createdSession && !isCreating && !error) {
      void createSession({ allowGuestControl: false, maxParticipants: 5 });
    }
  }, [initialSession, createdSession, isCreating, error, createSession]);

  // Poll for participant updates while session is active
  const refreshSessionRef = useRef(refreshSession);
  refreshSessionRef.current = refreshSession;

  useEffect(() => {
    if (!session?.id) return;

    void refreshSessionRef.current();

    const interval = setInterval(() => {
      void refreshSessionRef.current();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [session?.id]);

  // Stop screen sharing only (session continues with voice)
  const handleStopScreenShare = useCallback(() => {
    onStopCapture?.();
  }, [onStopCapture]);

  // End the entire session (nuclear option)
  const handleEndSession = useCallback(async () => {
    // Stop all RTMP streams first
    if (isAnyStreaming) {
      await stopAllStreams();
    }
    // Stop WebRTC hosting
    if (isHosting) {
      stopHosting();
    }
    if (session) {
      await endSession();
    }
    onStop();
  }, [session, endSession, onStop, isHosting, stopHosting, isAnyStreaming, stopAllStreams]);

  const handleCopyLink = useCallback(async () => {
    if (!session) return;

    const joinUrl = `${APP_URL}/join/${session.join_code}`;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [session]);

  const handleCopyCode = useCallback(async () => {
    if (!session) return;

    await navigator.clipboard.writeText(session.join_code);
    setCopiedCode(true);
    setTimeout(() => {
      setCopiedCode(false);
    }, 2000);
  }, [session]);

  // Participant management actions
  // Build headers with auth token for API calls
  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authTokenRef.current) {
      headers.Authorization = `Bearer ${authTokenRef.current}`;
    }
    return headers;
  }, []);

  const resolveViewerTargetId = useCallback(
    (participantId: string): string | null => {
      const participant = participants.find((p) => p.id === participantId);
      if (!participant) return null;

      const candidates = [participant.user_id, participant.id].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      );

      for (const candidate of candidates) {
        if (hostedViewers.has(candidate)) return candidate;
      }

      return candidates[0] ?? null;
    },
    [participants, hostedViewers]
  );

  const handleGrantControl = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${session.id}/participants/${participantId}/control`,
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ control_state: 'granted' }),
          }
        );
        if (!response.ok) {
          console.error('Failed to grant control');
          return;
        }

        const viewerId = resolveViewerTargetId(participantId);
        if (viewerId) {
          grantControl(viewerId);
        } else {
          console.warn('[CapturePreview] Could not resolve viewer target for grant control', {
            participantId,
          });
        }
      } catch (err) {
        console.error('Error granting control:', err);
      }
    },
    [session, getAuthHeaders, resolveViewerTargetId, grantControl]
  );

  const handleRevokeControl = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${session.id}/participants/${participantId}/control`,
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ control_state: 'view-only' }),
          }
        );
        if (!response.ok) {
          console.error('Failed to revoke control');
          return;
        }

        const viewerId = resolveViewerTargetId(participantId);
        if (viewerId) {
          revokeControl(viewerId);
        } else {
          console.warn('[CapturePreview] Could not resolve viewer target for revoke control', {
            participantId,
          });
        }
      } catch (err) {
        console.error('Error revoking control:', err);
      }
    },
    [session, getAuthHeaders, resolveViewerTargetId, revokeControl]
  );

  const handleKickParticipant = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${session.id}/participants/${participantId}`,
          {
            method: 'DELETE',
            headers: getAuthHeaders(),
          }
        );
        if (!response.ok) {
          console.error('Failed to kick participant');
          return;
        }

        const viewerId = resolveViewerTargetId(participantId);
        if (viewerId) {
          kickViewer(viewerId);
        } else {
          console.warn('[CapturePreview] Could not resolve viewer target for kick', {
            participantId,
          });
        }
      } catch (err) {
        console.error('Error kicking participant:', err);
      }
    },
    [session, getAuthHeaders, resolveViewerTargetId, kickViewer]
  );

  const handleStartRecording = useCallback(async () => {
    if (!source || !stream) return;
    setSpaceWarning(null);

    // Build a recording stream that includes video + mixed audio (host mic + viewer audio).
    // The mixer's output is a live AudioContext graph, so viewers joining/leaving during
    // recording are automatically included without needing to restart MediaRecorder.
    let recordingStream: MediaStream;
    if (includeAudio && mixedStream) {
      recordingStream = new MediaStream();
      // Video from the screen capture
      stream.getVideoTracks().forEach((track) => {
        recordingStream.addTrack(track);
      });
      // Audio from the mixer (host mic + all viewer audio combined)
      mixedStream.getAudioTracks().forEach((track) => {
        recordingStream.addTrack(track);
      });
    } else {
      recordingStream = stream;
    }

    await startRecording(source.id, {
      quality: recordingQuality,
      format: 'webm',
      includeAudio,
      // Pass the combined stream — Wayland-safe and includes all participant audio
      existingStream: recordingStream,
    });
  }, [source, recordingQuality, includeAudio, startRecording, stream, mixedStream]);

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

  const handleMuteParticipant = useCallback(
    (participantIdentity: string, muted: boolean) => {
      muteViewer(participantIdentity, muted);
      setMutedParticipants((prev) => {
        const next = new Set(prev);
        if (muted) {
          next.add(participantIdentity);
        } else {
          next.delete(participantIdentity);
        }
        return next;
      });
    },
    [muteViewer]
  );

  const isScreen = source?.type === 'screen';
  const activeParticipants = participants.filter((p) => !p.left_at);

  return (
    <div className="flex flex-1">
      {/* Main content */}
      <div className="flex flex-1 flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {stream ? (
              isScreen ? (
                <Monitor className="h-5 w-5 text-primary" />
              ) : (
                <AppWindow className="h-5 w-5 text-primary" />
              )
            ) : (
              <Mic className="h-5 w-5 text-primary" />
            )}
            <div>
              <h2 className="text-lg font-semibold">
                {source?.name ?? (stream ? 'Capturing' : 'Voice Session')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {stream
                  ? `${isScreen ? 'Screen' : 'Window'} capture active`
                  : 'Voice only — no screen shared'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Participants toggle */}
            <Button
              variant={showParticipants ? 'default' : 'secondary'}
              size="sm"
              onClick={() => {
                setShowParticipants(!showParticipants);
              }}
            >
              <Users />
              Participants
            </Button>

            {/* Chat toggle */}
            <Button
              variant={showChat ? 'default' : 'secondary'}
              size="sm"
              onClick={() => {
                setShowChat(!showChat);
              }}
            >
              <MessageSquare />
              Chat
            </Button>

            {/* Recording controls (only when screen sharing) */}
            {stream && (
              <div className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1">
                {!isRecording ? (
                  <>
                    <select
                      value={recordingQuality}
                      onChange={(e) => {
                        setRecordingQuality(e.target.value as RecordingQuality);
                      }}
                      className="h-9 rounded-md bg-background px-2 text-sm"
                      title="Recording quality - affects file size and bitrate"
                    >
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="4k">4K (where available)</option>
                    </select>
                    <Button
                      variant={includeAudio ? 'default' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        setIncludeAudio(!includeAudio);
                      }}
                      title={includeAudio ? 'Audio enabled' : 'Audio disabled'}
                    >
                      {includeAudio ? <Volume2 /> : <VolumeX />}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-red-600 text-white hover:bg-red-700"
                      onClick={() => void handleStartRecording()}
                      title="Start recording to local file"
                    >
                      <Circle className="!size-3 fill-current" />
                      Record
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex h-9 items-center gap-1.5 px-2 font-mono text-sm">
                      <Circle className="h-2 w-2 animate-pulse fill-red-500 text-red-500" />
                      {formatDuration(duration)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => void handleTogglePause()}
                      title={isPaused ? 'Resume' : 'Pause'}
                    >
                      {isPaused ? <Play /> : <Pause />}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleStopRecording()}
                    >
                      <StopCircle />
                      Stop
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => void openRecordingsFolder()}
                      title="Open recordings folder"
                    >
                      <FolderOpen />
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Streaming controls (only when screen sharing) */}
            {stream && destinations.length > 0 && (
              <StreamControls
                stream={stream}
                destinations={destinations}
                streamStatuses={streamStatuses}
                isAnyStreaming={isAnyStreaming}
                onStartStream={startStream}
                onStopStream={stopStream}
                onStartAll={startAllStreams}
                onStopAll={stopAllStreams}
              />
            )}

            {/* Share Screen button (when no stream) */}
            {!stream && onStartCapture && (
              <Button variant="default" size="sm" onClick={onStartCapture}>
                <Monitor className="h-4 w-4" />
                Share Screen
              </Button>
            )}

            {/* Stop Sharing button (only when actively sharing) */}
            {stream && onStopCapture && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleStopScreenShare}
                disabled={isRecording || isAnyStreaming}
                title={
                  isRecording
                    ? 'Stop recording first'
                    : isAnyStreaming
                      ? 'Stop streaming first'
                      : 'Stop screen sharing'
                }
              >
                <StopCircle />
                Stop Sharing
              </Button>
            )}

            {/* End Session button (always visible) */}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleEndSession()}
              disabled={isEnding || isRecording || isAnyStreaming}
              title={
                isRecording
                  ? 'Stop recording first'
                  : isAnyStreaming
                    ? 'Stop streaming first'
                    : 'End session and disconnect all participants'
              }
            >
              {isEnding ? <Loader2 className="animate-spin" /> : <StopCircle />}
              End Session
            </Button>
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

        {/* Hosting error */}
        {hostingError && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Streaming error: {hostingError}
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
                <button
                  onClick={() => void handleCopyCode()}
                  className="font-mono text-sm font-medium hover:underline"
                  title="Copy join code"
                >
                  {session.join_code}
                </button>
                {copiedCode && <span className="text-xs text-green-500">Copied</span>}
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
                {viewerCount} connected{viewerCount !== 1 ? '' : ''}
                {activeParticipants.length > 0 && ` (${String(activeParticipants.length)} joined)`}
              </div>

              {/* Microphone toggle for streaming audio */}
              <Button
                variant={hostMicEnabled ? 'default' : 'secondary'}
                size="sm"
                onClick={hostToggleMic}
                disabled={!hostHasMic}
                title={
                  !hostHasMic
                    ? 'No microphone available'
                    : hostMicEnabled
                      ? 'Mute microphone'
                      : 'Unmute microphone'
                }
              >
                {hostMicEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                {hostMicEnabled ? 'Mic On' : 'Mic Off'}
              </Button>
            </div>

            {stream && (
              <span className="font-mono text-sm text-muted-foreground">
                {stream.getVideoTracks()[0]?.getSettings().width ?? 0} x{' '}
                {stream.getVideoTracks()[0]?.getSettings().height ?? 0}
              </span>
            )}
            {!stream && <span className="text-sm text-muted-foreground">Voice Only</span>}
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
            className={`h-full w-full object-contain ${!stream ? 'hidden' : ''}`}
          />

          {/* Voice-only placeholder when no screen is shared */}
          {!stream && (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
                <Mic className="h-8 w-8 text-gray-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-300">No screen is being shared</p>
                <p className="mt-1 text-xs text-gray-500">Voice session active</p>
              </div>
              {onStartCapture && (
                <Button variant="secondary" size="sm" onClick={onStartCapture} className="mt-2">
                  <Monitor className="h-4 w-4" />
                  Share Screen
                </Button>
              )}
            </div>
          )}

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

          {/* Streaming indicator */}
          {isAnyStreaming && (
            <div className={`absolute right-4 ${isRecording ? 'top-12' : 'top-4'}`}>
              <StreamIndicator
                activeCount={activeStreamCount}
                totalDuration={Math.max(
                  ...Array.from(streamStatuses.values())
                    .filter((s) => s.status === 'live')
                    .map((s) => s.duration),
                  0
                )}
              />
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
            onMuteParticipant={handleMuteParticipant}
            mutedParticipants={mutedParticipants}
          />
        </div>
      )}

      {/* Chat panel */}
      {session && showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={currentUserId}
          isHost={true}
          mutedParticipants={mutedParticipants}
          onGrantControl={(participant) => {
            void handleGrantControl(participant.id);
          }}
          onRevokeControl={(participant) => {
            void handleRevokeControl(participant.id);
          }}
          onKickParticipant={(participant) => {
            void handleKickParticipant(participant.id);
          }}
          onMuteParticipant={(participant, muted) => {
            const targetId =
              resolveViewerTargetId(participant.id) ?? participant.user_id ?? participant.id;
            handleMuteParticipant(targetId, muted);
          }}
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
