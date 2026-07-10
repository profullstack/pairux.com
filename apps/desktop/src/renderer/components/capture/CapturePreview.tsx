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
  Video,
  VideoOff,
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
import { useCamera } from '@/hooks/useCamera';
import { useScreenCameraCompositor, type BubbleGeometry } from '@/hooks/useScreenCameraCompositor';
import { CameraBubble } from '@/components/capture/CameraBubble';
import { PublishToLive } from '@/components/capture/PublishToLive';
import { useRTMPStreaming } from '@/hooks/useRTMPStreaming';
import { useLiveStreamEnabled } from '@/lib/liveStream';
import { getDefaultSessionMode } from '@/lib/sessionDefaults';
import { useWebRTCHostAPI } from '@/hooks/useWebRTCHostAPI';
import { useWebRTCHostSFUAPI } from '@/hooks/useWebRTCHostSFUAPI';
import { useAutoStopServerStream } from '@/hooks/useAutoStopServerStream';
import { useAudioMixer } from '@/hooks/useAudioMixer';
import { useInputInjection } from '@/hooks/useInputInjection';
import {
  SharingIndicator,
  RecordingIndicator,
  ControlActiveIndicator,
  RemoteCursorsContainer,
  useRemoteCursors,
} from '@/components/overlay';

const CAMERA_BUBBLE_STORAGE_KEY = 'pairux-camera-bubble';
// Default: lower-right corner, ~20% of frame height (Loom-style).
const DEFAULT_BUBBLE_GEOMETRY: BubbleGeometry = { x: 0.84, y: 0.8, size: 0.2 };

function loadBubbleGeometry(): BubbleGeometry {
  try {
    const saved = localStorage.getItem(CAMERA_BUBBLE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<BubbleGeometry>;
      return {
        x: typeof parsed.x === 'number' ? parsed.x : DEFAULT_BUBBLE_GEOMETRY.x,
        y: typeof parsed.y === 'number' ? parsed.y : DEFAULT_BUBBLE_GEOMETRY.y,
        size: typeof parsed.size === 'number' ? parsed.size : DEFAULT_BUBBLE_GEOMETRY.size,
      };
    }
  } catch {
    // Ignore parse errors and fall back to defaults.
  }
  return DEFAULT_BUBBLE_GEOMETRY;
}

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
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [spaceWarning, setSpaceWarning] = useState<number | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const [waylandInputDiagnosticsDismissed, setWaylandInputDiagnosticsDismissed] = useState(false);

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

  // Optional Loom-style camera bubble. Always off by default; fully optional.
  const camera = useCamera();
  const [bubbleGeometry, setBubbleGeometry] = useState<BubbleGeometry>(loadBubbleGeometry);
  const bubbleGeometryRef = useRef(bubbleGeometry);
  bubbleGeometryRef.current = bubbleGeometry;

  const handleBubbleChange = useCallback((geometry: BubbleGeometry) => {
    setBubbleGeometry(geometry);
    try {
      localStorage.setItem(CAMERA_BUBBLE_STORAGE_KEY, JSON.stringify(geometry));
    } catch {
      // Persisting position is best-effort.
    }
  }, []);

  // Composite the screen share with the camera bubble. Only active when both a screen
  // and the camera are present; otherwise we publish/record the raw video track.
  const compositeStream = useScreenCameraCompositor({
    screenStream: stream,
    cameraStream: camera.stream,
    geometryRef: bubbleGeometryRef,
    enabled: camera.isEnabled && Boolean(stream),
  });

  const handleToggleCamera = useCallback(() => {
    void camera.toggle();
  }, [camera]);

  const {
    destinations,
    streamStatuses,
    streamWarnings,
    isAnyStreaming,
    activeStreamCount,
    startStream,
    stopStream,
    startAllStreams,
    stopAllStreams,
    isServerStreaming,
    startServerStream,
    stopServerStream,
  } = useRTMPStreaming({
    onStreamError: (destId, err) => {
      console.error(`[CapturePreview] Stream ${destId} error:`, err);
    },
  });

  const liveStreamEnabled = useLiveStreamEnabled();

  // Use initialSession if provided, otherwise use created session
  const session = initialSession ?? createdSession;
  const canModerateSession = Boolean(
    session &&
    currentUserId &&
    (session.host_user_id === currentUserId || session.current_host_id === currentUserId)
  );
  const canManageParticipantControl = Boolean(session);

  // Remote cursors for showing viewer cursor positions
  const { cursors: remoteCursors } = useRemoteCursors();

  // Determine mode from whichever session exists (joined OR auto-created by
  // quick-share). Both host hooks are always called; only the selection below
  // switches, and hosting doesn't start until a session exists, so the flip
  // from "no session" to "sfu session" happens before anything connects.
  const isSFU = session?.mode === 'sfu';

  // Find participant with control granted (used to enable host-side input injection)
  const participantWithControl = useMemo(() => {
    return participants.find((p) => p.control_state === 'granted' && !p.left_at) ?? null;
  }, [participants]);

  const inputScreenSize = useMemo(() => {
    if (!stream) return undefined;
    const tracks = stream.getVideoTracks();
    const track = tracks.length > 0 ? tracks[0] : undefined;
    const settings = track?.getSettings();
    const width = settings?.width;
    const height = settings?.height;
    if (!width || !height) return undefined;
    return { width, height };
  }, [stream]);

  const { injectEvent, diagnostics: inputDiagnostics } = useInputInjection({
    enabled: Boolean(participantWithControl),
    screenSize: inputScreenSize,
  });
  const remoteInputCountRef = useRef(0);
  const showWaylandInputDiagnostics =
    Boolean(session) &&
    inputDiagnostics?.backend.startsWith('wayland-') === true &&
    !inputDiagnostics.backendSupported &&
    !waylandInputDiagnosticsDismissed;

  const hostHookOptions = useMemo(
    () => ({
      sessionId: session?.id ?? '',
      hostId: currentUserId ?? session?.id ?? '',
      localStream: stream,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      allowControl: Boolean(session?.settings?.allowControl),
      onViewerJoined: (viewerId: string) => {
        console.log('[CapturePreview] Viewer joined:', viewerId);
        void refreshSession();
      },
      onViewerLeft: (viewerId: string) => {
        console.log('[CapturePreview] Viewer left:', viewerId);
        void refreshSession();
      },
      onInputReceived: (viewerId: string, input: InputMessage) => {
        remoteInputCountRef.current += 1;
        if (remoteInputCountRef.current <= 3 || remoteInputCountRef.current % 100 === 0) {
          console.log('[CapturePreview] Remote input received', {
            viewerId,
            count: remoteInputCountRef.current,
            type: input.event.type,
            action: 'action' in input.event ? input.event.action : undefined,
            grantedParticipantId: participantWithControl?.id ?? null,
          });
        }
        void injectEvent(input.event);
      },
      onCursorUpdate: (_viewerId: string, _cursor: CursorPositionMessage) => {
        // TODO: Update remote cursor position
      },
    }),
    [
      session?.id,
      currentUserId,
      stream,
      session?.settings.allowControl,
      injectEvent,
      participantWithControl?.id,
      refreshSession,
    ]
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
    hostMicStream,
  } = isSFU ? sfuHost : p2pHost;

  // Audio mixer: combines host mic + all viewer audio into one stream for recording
  const {
    mixedStream,
    addTrack: mixerAddTrack,
    removeTrack: mixerRemoveTrack,
    setTrackMuted: mixerSetTrackMuted,
    dispose: disposeMixer,
  } = useAudioMixer();

  // Add host mic audio to the mixer.
  // Source from the host's dedicated mic stream (alive for the whole session)
  // rather than the screen stream, so the host stays audible to viewers and in
  // recordings whether or not a screen is being shared.
  useEffect(() => {
    if (!hostMicStream) return;
    const audioTracks = hostMicStream.getAudioTracks();
    if (audioTracks.length > 0) {
      mixerAddTrack('host-mic', audioTracks[0], false);
    }
    return () => {
      mixerRemoveTrack('host-mic');
    };
  }, [hostMicStream, mixerAddTrack, mixerRemoveTrack]);

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

  useEffect(() => {
    for (const viewer of hostedViewers.values()) {
      if (viewer.audioElement) {
        viewer.audioElement.muted = speakerMuted || viewer.isMuted;
      }
    }
  }, [hostedViewers, speakerMuted]);

  // Start hosting (voice channel) when session is available -- no stream required
  useEffect(() => {
    if (session !== null && !isHosting) {
      console.log('[CapturePreview] Starting WebRTC hosting for session:', session.id);
      void startHosting();
    }
  }, [session, isHosting, startHosting]);

  // Liveness heartbeat: while actively hosting, ping the server so a published
  // room shows as live on pairux.com/live — and, critically, so it falls OFF
  // /live automatically when this app is closed/killed (the pings just stop).
  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId || !isHosting) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
        if (!token || cancelled) return;
        await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/heartbeat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best effort — a missed ping just delays the live/offline flip
      }
    };
    void ping(); // stamp immediately so the room appears live without a 30s wait
    const interval = setInterval(() => void ping(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session?.id, isHosting]);

  // The video track presented to viewers and recorded locally:
  //  - screen + camera -> composited (screen with the bubble baked in)
  //  - screen only      -> raw screen
  //  - camera only      -> raw camera (lets people share their face in voice calls)
  //  - neither          -> none (voice only)
  const presentationVideoTrack = useMemo(() => {
    if (compositeStream) return compositeStream.getVideoTracks()[0] ?? null;
    if (stream) return stream.getVideoTracks()[0] ?? null;
    if (camera.stream) return camera.stream.getVideoTracks()[0] ?? null;
    return null;
  }, [compositeStream, stream, camera.stream]);

  // Publish the presentation track when available.
  // Use the mixer output when available so live WebRTC matches recording audio
  // behavior (host mic + any routed audio sources).
  useEffect(() => {
    if (!isHosting || !presentationVideoTrack) return;

    const publishStream = new MediaStream();
    publishStream.addTrack(presentationVideoTrack);

    const mixedAudioTracks = mixedStream?.getAudioTracks() ?? [];
    const fallbackAudioTracks = stream?.getAudioTracks() ?? [];
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
  }, [presentationVideoTrack, mixedStream, isHosting, hostPublishStream, stream]);

  // The stream handed to the RTMP broadcast. Critically this carries the *mixed*
  // audio (host mic + every viewer) — the same track published to viewers and
  // recorded — instead of the raw screen capture, which has no call audio. The
  // mixer's output track is stable, so late joiners are included automatically.
  const broadcastStream = useMemo(() => {
    if (!presentationVideoTrack) return null;
    const composed = new MediaStream();
    composed.addTrack(presentationVideoTrack);
    const mixedAudioTracks = mixedStream?.getAudioTracks() ?? [];
    const fallbackAudioTracks = stream?.getAudioTracks() ?? [];
    const audioTracks = mixedAudioTracks.length > 0 ? mixedAudioTracks : fallbackAudioTracks;
    audioTracks.forEach((track) => {
      composed.addTrack(track);
    });
    return composed;
  }, [presentationVideoTrack, mixedStream, stream]);

  // Unpublish when there is nothing to show (session stays alive)
  useEffect(() => {
    if (!presentationVideoTrack && isHosting) {
      void hostUnpublishStream();
    }
  }, [presentationVideoTrack, isHosting, hostUnpublishStream]);

  // Stop hosting when component unmounts
  useEffect(() => {
    return () => {
      if (isHosting) {
        stopHosting();
      }
    };
  }, [isHosting, stopHosting]);

  // Stop the server egress if hosting ends while it is still running, so a host
  // publish drop doesn't strand an orphaned room-composite egress on the SFU.
  useAutoStopServerStream(isHosting, isServerStreaming, stopServerStream);

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
      // Mode comes from Settings (default SFU so "Go Live (server)" is
      // available — quick-share never shows the mode picker).
      void createSession({
        allowGuestControl: false,
        maxParticipants: 5,
        mode: getDefaultSessionMode(),
      });
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
    if (session && canModerateSession) {
      await endSession();
    }
    onStop();
  }, [
    session,
    canModerateSession,
    endSession,
    onStop,
    isHosting,
    stopHosting,
    isAnyStreaming,
    stopAllStreams,
  ]);

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

        // Sync session participants so host-side input injection sees the granted state immediately.
        await refreshSession();
      } catch (err) {
        console.error('Error granting control:', err);
      }
    },
    [session, getAuthHeaders, resolveViewerTargetId, grantControl, refreshSession]
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

        // Sync session participants so host-side input injection disables immediately.
        await refreshSession();
      } catch (err) {
        console.error('Error revoking control:', err);
      }
    },
    [session, getAuthHeaders, resolveViewerTargetId, revokeControl, refreshSession]
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

  const handleTransferHost = useCallback(
    async (participantId: string) => {
      if (!session) return;
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${session.id}/participants/${participantId}/host`,
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
          }
        );
        if (!response.ok) {
          console.error('Failed to transfer host');
          return;
        }
        await refreshSession();
      } catch (err) {
        console.error('Error transferring host:', err);
      }
    },
    [session, getAuthHeaders, refreshSession]
  );

  const handleStartRecording = useCallback(async () => {
    if (!source || !stream) return;
    setSpaceWarning(null);

    // Record the same video the viewers see — the composited track (screen + camera
    // bubble) when the camera is on, otherwise the raw screen track.
    const screenVideoTrack = stream.getVideoTracks()[0];
    const videoTrack = presentationVideoTrack ?? screenVideoTrack;
    const usingComposite = videoTrack !== screenVideoTrack;

    // Build a recording stream that includes video + mixed audio (host mic + viewer audio).
    // The mixer's output is a live AudioContext graph, so viewers joining/leaving during
    // recording are automatically included without needing to restart MediaRecorder.
    let recordingStream: MediaStream;
    if (includeAudio || usingComposite) {
      recordingStream = new MediaStream();
      recordingStream.addTrack(videoTrack);
      // Audio from the mixer (host mic + all viewer audio combined), falling back to
      // the screen capture's own audio tracks.
      const audioTracks =
        includeAudio && mixedStream ? mixedStream.getAudioTracks() : stream.getAudioTracks();
      audioTracks.forEach((track) => {
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
  }, [
    source,
    recordingQuality,
    includeAudio,
    startRecording,
    stream,
    mixedStream,
    presentationVideoTrack,
  ]);

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

            {/* Camera bubble toggle (optional, off by default) */}
            <Button
              variant={camera.isEnabled ? 'default' : 'secondary'}
              size="sm"
              onClick={handleToggleCamera}
              disabled={camera.isStarting || isRecording}
              title={
                isRecording
                  ? 'Stop recording to change the camera'
                  : camera.isEnabled
                    ? 'Turn camera off'
                    : 'Turn camera on (drag the bubble to reposition)'
              }
            >
              {camera.isStarting ? (
                <Loader2 className="animate-spin" />
              ) : camera.isEnabled ? (
                <Video />
              ) : (
                <VideoOff />
              )}
              Camera
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

            {/* Streaming controls — broadcast the presentation video + mixed
                call audio (not the silent raw screen capture). */}
            {broadcastStream && destinations.length > 0 && (
              <StreamControls
                stream={broadcastStream}
                destinations={destinations}
                streamStatuses={streamStatuses}
                streamWarnings={streamWarnings}
                isAnyStreaming={isAnyStreaming}
                liveStreamEnabled={liveStreamEnabled}
                onStartStream={startStream}
                onStopStream={stopStream}
                onStartAll={startAllStreams}
                onStopAll={stopAllStreams}
                serverStream={{
                  // Server restream needs the room to live on the SFU
                  // (isSFU already implies an existing session)
                  available: isSFU,
                  isStreaming: isServerStreaming,
                  onStart: () =>
                    session
                      ? startServerStream(session.id)
                      : Promise.resolve({ success: false, error: 'No active session' }),
                  onStop: stopServerStream,
                }}
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

        {/* Camera error */}
        {camera.error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Camera error: {camera.error}
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
                variant={speakerMuted ? 'secondary' : 'default'}
                size="sm"
                onClick={() => {
                  setSpeakerMuted((prev) => !prev);
                }}
                title={speakerMuted ? 'Turn speaker on' : 'Turn speaker off'}
              >
                {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {speakerMuted ? 'Speaker Off' : 'Speaker On'}
              </Button>
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

              {/* Publish the room to the public pairux.com/live directory */}
              {canModerateSession && <PublishToLive session={session} />}
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

        {showWaylandInputDiagnostics && (
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">Wayland remote control backend unavailable</div>
                  <button
                    type="button"
                    className="font-mono text-xs text-amber-900/80 hover:text-amber-950"
                    onClick={() => {
                      setWaylandInputDiagnosticsDismissed(true);
                    }}
                    aria-label="Dismiss Wayland backend warning"
                    title="Dismiss"
                  >
                    [x]
                  </button>
                </div>
                <div className="text-amber-900/90">
                  {inputDiagnostics.reason ?? 'Wayland input backend is not ready.'}
                </div>
                {inputDiagnostics.backend === 'wayland-portal' && (
                  <div className="text-amber-900/90">
                    PairUX detected the Wayland portal, but PairUX portal-based input injection is
                    not implemented yet. This is informational only, not something you can enable in
                    portal settings today.
                  </div>
                )}
                <div className="font-mono text-xs leading-relaxed text-amber-900/90">
                  {(() => {
                    const portalDesktop =
                      (
                        inputDiagnostics.details as
                          | {
                              portalDesktopAvailable?: boolean;
                              portal?: { details?: { portalDesktopAvailable?: boolean } };
                            }
                          | undefined
                      )?.portalDesktopAvailable ??
                      (
                        inputDiagnostics.details as
                          | { portal?: { details?: { portalDesktopAvailable?: boolean } } }
                          | undefined
                      )?.portal?.details?.portalDesktopAvailable;
                    const hasYdotoolBinary =
                      (
                        inputDiagnostics.details as
                          | {
                              hasYdotoolBinary?: boolean;
                              ydotool?: { details?: { hasYdotoolBinary?: boolean } };
                            }
                          | undefined
                      )?.hasYdotoolBinary ??
                      (
                        inputDiagnostics.details as
                          | { ydotool?: { details?: { hasYdotoolBinary?: boolean } } }
                          | undefined
                      )?.ydotool?.details?.hasYdotoolBinary;
                    const hasYdotoolSocket =
                      (
                        inputDiagnostics.details as
                          | {
                              hasYdotoolSocket?: boolean;
                              ydotool?: { details?: { hasYdotoolSocket?: boolean } };
                            }
                          | undefined
                      )?.hasYdotoolSocket ??
                      (
                        inputDiagnostics.details as
                          | { ydotool?: { details?: { hasYdotoolSocket?: boolean } } }
                          | undefined
                      )?.ydotool?.details?.hasYdotoolSocket;

                    return (
                      <>
                        Backend: {inputDiagnostics.backend}
                        {' | '}portalDesktop:{' '}
                        {portalDesktop == null ? 'n/a' : String(portalDesktop)}
                        {' | '}hasYdotoolBinary:{' '}
                        {hasYdotoolBinary == null ? 'n/a' : String(hasYdotoolBinary)}
                        {' | '}hasYdotoolSocket:{' '}
                        {hasYdotoolSocket == null ? 'n/a' : String(hasYdotoolSocket)}
                      </>
                    );
                  })()}
                </div>
                <div className="space-y-1 rounded border border-amber-300/50 bg-white/70 p-2 font-mono text-xs">
                  {(() => {
                    const details = inputDiagnostics.details as
                      | {
                          ydotoolBinaryPath?: string;
                          ydotoolSocketPath?: string;
                          autoStartAttempted?: boolean;
                          autoStartMethod?: string | null;
                          autoStartError?: string | null;
                          currentDesktop?: string;
                          portalImplDetected?: string | null;
                          ydotool?: {
                            details?: {
                              ydotoolBinaryPath?: string;
                              ydotoolSocketPath?: string;
                              autoStartAttempted?: boolean;
                              autoStartMethod?: string | null;
                              autoStartError?: string | null;
                            };
                          };
                          portal?: {
                            details?: {
                              currentDesktop?: string;
                              portalImplDetected?: string | null;
                            };
                          };
                        }
                      | undefined;

                    const ydotoolBinaryPath =
                      details?.ydotoolBinaryPath ?? details?.ydotool?.details?.ydotoolBinaryPath;
                    const ydotoolSocketPath =
                      details?.ydotoolSocketPath ?? details?.ydotool?.details?.ydotoolSocketPath;
                    const autoStartAttempted =
                      details?.autoStartAttempted ?? details?.ydotool?.details?.autoStartAttempted;
                    const autoStartMethod =
                      details?.autoStartMethod ?? details?.ydotool?.details?.autoStartMethod;
                    const autoStartError =
                      details?.autoStartError ?? details?.ydotool?.details?.autoStartError;
                    const currentDesktop =
                      details?.currentDesktop ?? details?.portal?.details?.currentDesktop;
                    const portalImplDetected =
                      details?.portalImplDetected ?? details?.portal?.details?.portalImplDetected;

                    return (
                      <>
                        <div>Path status (auto-detected)</div>
                        <div>backend={inputDiagnostics.backend}</div>
                        <div>desktop={currentDesktop ?? 'n/a'}</div>
                        <div>portalImpl={portalImplDetected ?? 'n/a'}</div>
                        <div>ydotoolBin={ydotoolBinaryPath ?? 'n/a'}</div>
                        <div>ydotoolSocket={ydotoolSocketPath ?? 'n/a'}</div>
                        <div>ydotoolAutoStart={String(autoStartAttempted ?? false)}</div>
                        <div>ydotoolStartMethod={autoStartMethod ?? 'n/a'}</div>
                        {autoStartError ? <div>ydotoolStartError={autoStartError}</div> : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

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

          {/* Loom-style camera bubble (optional) */}
          {camera.isEnabled && camera.stream && (
            <CameraBubble
              stream={camera.stream}
              containerWidth={containerDimensions.width}
              containerHeight={containerDimensions.height}
              videoWidth={stream ? sourceDimensions.width : 0}
              videoHeight={stream ? sourceDimensions.height : 0}
              geometry={bubbleGeometry}
              onChange={handleBubbleChange}
              onClose={camera.disable}
            />
          )}
        </div>
      </div>

      {/* Participants panel */}
      {session && showParticipants && (
        <div className="w-72 shrink-0 border-l border-border bg-background p-4">
          <ParticipantList
            participants={participants}
            currentUserId={currentUserId}
            sessionId={session.id}
            isHost={canModerateSession}
            onGrantControl={canManageParticipantControl ? handleGrantControl : undefined}
            onRevokeControl={canManageParticipantControl ? handleRevokeControl : undefined}
            onKickParticipant={canModerateSession ? handleKickParticipant : undefined}
            onTransferHost={canModerateSession ? handleTransferHost : undefined}
            onMuteParticipant={canManageParticipantControl ? handleMuteParticipant : undefined}
            mutedParticipants={mutedParticipants}
          />
        </div>
      )}

      {/* Chat panel */}
      {session && showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={currentUserId}
          participants={participants.filter((p) => !p.left_at)}
          isHost={canModerateSession}
          mutedParticipants={mutedParticipants}
          onGrantControl={
            canManageParticipantControl
              ? (participant) => {
                  void handleGrantControl(participant.id);
                }
              : undefined
          }
          onRevokeControl={
            canManageParticipantControl
              ? (participant) => {
                  void handleRevokeControl(participant.id);
                }
              : undefined
          }
          onKickParticipant={
            canModerateSession
              ? (participant) => {
                  void handleKickParticipant(participant.id);
                }
              : undefined
          }
          onMuteParticipant={
            canManageParticipantControl
              ? (participant, muted) => {
                  const targetId =
                    resolveViewerTargetId(participant.id) ?? participant.user_id ?? participant.id;
                  handleMuteParticipant(targetId, muted);
                }
              : undefined
          }
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
