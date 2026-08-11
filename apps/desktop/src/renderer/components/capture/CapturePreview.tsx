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
  SessionParticipant,
} from '@pairux/shared-types';
import {
  DEFAULT_REMOTE_AUDIO_GAIN,
  MIN_REMOTE_AUDIO_GAIN,
  MAX_REMOTE_AUDIO_GAIN,
  clampAudioGain,
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
import { playJoinSound, playLeaveSound, useSessionSoundsEnabled } from '@/lib/sessionSounds';
import { isPreferTailnetEnabled } from '@/lib/iceConfig';
import { getDefaultAllowGuestControl, getDefaultSessionMode } from '@/lib/sessionDefaults';
import { useWebRTCHostAPI } from '@/hooks/useWebRTCHostAPI';
import { useWebRTCHostSFUAPI } from '@/hooks/useWebRTCHostSFUAPI';
import { useAutoStopServerStream } from '@/hooks/useAutoStopServerStream';
import { useAudioMixer } from '@/hooks/useAudioMixer';
import { useInputInjection } from '@/hooks/useInputInjection';
import { SharingIndicator, RecordingIndicator, ControlActiveIndicator } from '@/components/overlay';

// A control request the host has not answered yet. Expires so a request the
// host ignored does not sit in the UI forever.
interface PendingControlRequest {
  viewerId: string;
  requestedAt: number;
}

const CONTROL_REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long after hosting starts to stay silent.
 *
 * Reconnecting to a busy session reports every viewer as a fresh arrival, and a
 * burst of chimes for people who were already there is noise, not information.
 */
const JOIN_SOUND_SETTLE_MS = 2_000;

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
  const [speakerGain, setSpeakerGain] = useState(DEFAULT_REMOTE_AUDIO_GAIN);
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

  // Determine mode from whichever session exists (joined OR auto-created by
  // quick-share). Both host hooks are always called; only the selection below
  // switches, and hosting doesn't start until a session exists, so the flip
  // from "no session" to "sfu session" happens before anything connects.
  const isSFU = session?.mode === 'sfu';

  // Arrival/departure chimes.
  //
  // Read through a ref because the join and leave callbacks are built once and
  // handed to the WebRTC hooks; closing over the toggle directly would freeze
  // whatever it was when the session started.
  //
  // The settle window suppresses the volley that would otherwise fire when the
  // host reconnects to a session that already has people in it — every existing
  // viewer arrives at once, and none of them actually just walked in.
  const sessionSoundsEnabled = useSessionSoundsEnabled();
  const sessionSoundsEnabledRef = useRef(sessionSoundsEnabled);
  sessionSoundsEnabledRef.current = sessionSoundsEnabled;
  const hostingSinceRef = useRef<number | null>(null);
  const shouldChimeRef = useRef<() => boolean>(() => false);
  shouldChimeRef.current = (): boolean => {
    if (!sessionSoundsEnabledRef.current) return false;
    const since = hostingSinceRef.current;
    if (since === null) return false;
    return Date.now() - since > JOIN_SOUND_SETTLE_MS;
  };

  // The remote participant the host has handed control to, which is what
  // enables input injection.
  //
  // The host's own row is created with control_state 'granted' (they always
  // control their own machine), so it must be excluded — otherwise injection
  // switches on the moment a session is created, before anyone has joined.
  const participantWithControl = useMemo(() => {
    return (
      participants.find((p) => p.control_state === 'granted' && !p.left_at && p.role !== 'host') ??
      null
    );
  }, [participants]);

  // Viewers waiting on a control decision. Guests are anonymous and cannot
  // write control_state themselves, so requests arrive over the data channel
  // and live here until the host approves or denies them.
  const [pendingControlRequests, setPendingControlRequests] = useState<PendingControlRequest[]>([]);

  // The viewer this host has granted control to, as the host last decided it.
  //
  // participantWithControl comes from a 5s participant poll, and a response
  // already in flight when control is granted lands afterwards carrying the
  // pre-grant state — which silently switched injection back off a few seconds
  // into a session. Host intent is authoritative; the poll only corroborates.
  const [grantedViewerId, setGrantedViewerId] = useState<string | null>(null);

  // Read through refs so cursor updates (up to 60/s) never re-create the host
  // hook options and tear down the connection.
  const sourceDimensionsRef = useRef({ width: 1920, height: 1080 });
  const participantNameRef = useRef((viewerId: string) => viewerId);
  participantNameRef.current = (viewerId: string) =>
    participants.find((p) => p.user_id === viewerId || p.id === viewerId)?.display_name ??
    'Participant';

  const handleControlRequested = useCallback((viewerId: string) => {
    setPendingControlRequests((prev) =>
      prev.some((request) => request.viewerId === viewerId)
        ? prev
        : [...prev, { viewerId, requestedAt: Date.now() }]
    );
  }, []);

  // Drop requests the host never answered, matching the documented 30s timeout.
  const hasPendingControlRequests = pendingControlRequests.length > 0;
  useEffect(() => {
    if (!hasPendingControlRequests) return;

    const timer = setInterval(() => {
      const cutoff = Date.now() - CONTROL_REQUEST_TIMEOUT_MS;
      setPendingControlRequests((prev) => prev.filter((request) => request.requestedAt > cutoff));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [hasPendingControlRequests]);

  // No screenSize is passed on purpose: the injection backend reads the host's
  // real screen geometry from the OS itself. The capture track's dimensions are
  // the *encoded stream* size, which is a different number in different units,
  // and using it put every remote click in the wrong place. See useInputInjection.
  const { injectEvent, diagnostics: inputDiagnostics } = useInputInjection({
    enabled: Boolean(participantWithControl) || grantedViewerId !== null,
  });
  const remoteInputCountRef = useRef(0);
  const showWaylandInputDiagnostics =
    Boolean(session) &&
    inputDiagnostics?.backend.startsWith('wayland-') === true &&
    (!inputDiagnostics.backendSupported || Boolean(inputDiagnostics.reason)) &&
    !waylandInputDiagnosticsDismissed;

  // M2: offer tailnet candidates for the life of a peer-to-peer session.
  //
  // Scoped deliberately. Relaxing the policy re-admits every private interface,
  // including the dead secondary NICs that "force relay" exists to work around,
  // so it is applied only where it can pay off — P2P, opted in — and undone as
  // soon as the session ends. An SFU session connects to the server, which is
  // not on anyone's tailnet, so it is left alone.
  useEffect(() => {
    if (isSFU || !session || !isPreferTailnetEnabled()) return;

    const api = getElectronAPI();
    void api.invoke('webrtc:setIpPolicy', { allowPrivate: true }).catch(() => {
      // Falls back to the restrictive default, which is the safe direction.
    });

    return () => {
      void api.invoke('webrtc:setIpPolicy', { allowPrivate: false }).catch(() => {
        // Nothing to recover: the next session re-applies whichever it needs.
      });
    };
  }, [isSFU, session]);

  // Would a direct WireGuard path to this participant exist?
  //
  // Diagnostic only: media still goes over the SFU. A DERP result counts as no
  // for our purposes — that is another relay, and buys nothing over the TURN
  // server already in use. Only a native peer can answer; a browser has no way
  // to learn its own tailnet address.
  const handleTailnetHello = useCallback((viewerId: string, ips: string[], isReply: boolean) => {
    void (async () => {
      const api = getElectronAPI();

      if (!isReply) {
        // Someone greeted us first; answer with our own addresses.
        const info = await api.invoke('tailscale:info', undefined).catch(() => null);
        hostTailnetHelloRef.current?.(viewerId, info?.ips ?? [], true);
      }

      if (ips.length === 0) {
        console.log('[Tailnet] Peer is not on a tailnet — no direct path', { viewerId });
        return;
      }

      for (const ip of ips) {
        const result = await api.invoke('tailscale:checkPath', { ip }).catch(() => null);
        if (!result?.reachable) continue;

        console.log(
          result.direct
            ? '[Tailnet] Direct path available — media over the tailnet would work'
            : '[Tailnet] Reachable only via a relay — no better than the current TURN path',
          { viewerId, ip, via: result.via }
        );
        return;
      }

      console.log('[Tailnet] Peer reported addresses but none were reachable', { viewerId, ips });
    })();
  }, []);

  // Set after the host hook resolves; the callback above runs long after.
  const hostTailnetHelloRef = useRef<
    ((viewerId: string, ips: string[], reply: boolean) => void) | null
  >(null);

  const hostHookOptions = useMemo(
    () => ({
      sessionId: session?.id ?? '',
      hostId: currentUserId ?? session?.id ?? '',
      localStream: stream,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      allowControl: Boolean(session?.settings?.allowControl),
      onViewerJoined: (viewerId: string) => {
        console.log('[CapturePreview] Viewer joined:', viewerId);
        if (shouldChimeRef.current()) playJoinSound();
        void refreshSession();
      },
      onViewerLeft: (viewerId: string) => {
        console.log('[CapturePreview] Viewer left:', viewerId);
        if (shouldChimeRef.current()) playLeaveSound();
        // A departing viewer's control ends with them, which also releases
        // anything they were still holding down on this machine.
        setGrantedViewerId((prev) => (prev === viewerId ? null : prev));
        setPendingControlRequests((prev) =>
          prev.filter((request) => request.viewerId !== viewerId)
        );
        void refreshSession();
      },
      onControlRequest: handleControlRequested,
      onTailnetHello: handleTailnetHello,
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
    }),
    [
      session?.id,
      currentUserId,
      stream,
      session?.settings.allowControl,
      injectEvent,
      participantWithControl?.id,
      refreshSession,
      handleControlRequested,
      handleTailnetHello,
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
    setSpeakerGain: hostSetSpeakerGain,
  } = isSFU ? sfuHost : p2pHost;

  // Answer the handshake over whichever transport is actually carrying it.
  hostTailnetHelloRef.current = isSFU ? sfuHost.sendTailnetHello : p2pHost.sendTailnetHello;

  // Start the chime settle window when hosting begins, and close it when
  // hosting ends so a later session starts quiet again.
  useEffect(() => {
    hostingSinceRef.current = isHosting ? Date.now() : null;
  }, [isHosting]);

  // Drive the gain stage in front of every participant's playback. Mute is left
  // to the audio elements; this only controls how loud they are when unmuted.
  useEffect(() => {
    hostSetSpeakerGain(speakerGain);
  }, [hostSetSpeakerGain, speakerGain, hostedViewers]);

  // Audio mixer: combines host mic + all viewer audio into one stream.
  //
  // This mix is for RECORDING ONLY. It must never be published back to
  // viewers: it contains their own audio, so sending it out would return each
  // viewer's voice to them and close a feedback loop through the host.
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
        // playback=false: the WebRTC hook already plays every viewer track
        // through its own <audio> element. Routing it to the speakers a second
        // time via the AudioContext makes the host hear each viewer twice,
        // offset by the graph's buffer — which sounds exactly like an echo.
        mixerAddTrack(viewerId, viewer.audioTrack, false);
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
  //
  // The audio here is the host's own microphone and nothing else. It must NOT
  // be the recording mixer's output: that mix contains every viewer's audio,
  // so publishing it would send each viewer their own voice back and close a
  // feedback loop through the host. Screen capture is requested with
  // `audio: false` on every desktop path, so the mic is the only source there
  // is to publish.
  //
  // Sending the raw capture track also keeps it on the browser's native path,
  // where echo cancellation and the encoder see an untouched mic signal.
  useEffect(() => {
    if (!isHosting || !presentationVideoTrack) return;

    const publishStream = new MediaStream();
    publishStream.addTrack(presentationVideoTrack);

    const micTrack = hostMicStream?.getAudioTracks()[0] ?? stream?.getAudioTracks()[0] ?? null;
    if (micTrack) {
      publishStream.addTrack(micTrack);
    }

    console.log('[CapturePreview] Publishing live stream to viewers', {
      videoTracks: publishStream.getVideoTracks().length,
      audioTracks: publishStream.getAudioTracks().length,
      audioSource: hostMicStream ? 'host-mic' : 'capture-stream',
    });

    void hostPublishStream(publishStream);
  }, [presentationVideoTrack, hostMicStream, isHosting, hostPublishStream, stream]);

  // The stream handed to the RTMP broadcast. Like the recording — and unlike
  // what is published to viewers — this carries the *mixed* audio (host mic +
  // every viewer) instead of the raw screen capture, which has no call audio.
  // Mixing every voice in is correct here because the broadcast is one-way to
  // an outside audience: nothing is returned to the people in the call, so
  // there is no loop to close. The mixer's output track is stable, so late
  // joiners are included automatically.
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
  sourceDimensionsRef.current = sourceDimensions;

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
        allowGuestControl: getDefaultAllowGuestControl(),
        maxParticipants: 5,
        mode: getDefaultSessionMode(),
      });
    }
  }, [initialSession, createdSession, isCreating, error, createSession]);

  // Mirror sharing state to the main process so `pairux --daemon` can answer
  // the web app without asking the renderer each time.
  useEffect(() => {
    const api = getElectronAPI();
    void api
      .invoke('daemon:reportState', {
        sharing: Boolean(session),
        sessionId: session?.id ?? null,
        joinCode: session?.join_code ?? null,
        url: session ? `${APP_URL}/join/${session.join_code}` : null,
      })
      .catch(() => {
        // Daemon mode is optional; never let it disturb a session.
      });
  }, [session]);

  // Daemon mode: the web app can ask this device to stop sharing.
  useEffect(() => {
    const unsubscribe = getElectronAPI().on('daemon:stop-session', () => {
      void endSession();
    });
    return unsubscribe;
  }, [endSession]);

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
          setGrantedViewerId(viewerId);
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
        setGrantedViewerId((prev) => (prev === viewerId ? null : prev));
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

  // A viewer id is whatever the transport calls the peer; map it back to the
  // session participant row so control_state can be persisted for it.
  const resolveParticipantFromViewerId = useCallback(
    (viewerId: string): SessionParticipant | null =>
      participants.find((p) => !p.left_at && (p.user_id === viewerId || p.id === viewerId)) ?? null,
    [participants]
  );

  const dismissControlRequest = useCallback((viewerId: string) => {
    setPendingControlRequests((prev) => prev.filter((request) => request.viewerId !== viewerId));
  }, []);

  const handleApproveControlRequest = useCallback(
    async (viewerId: string) => {
      dismissControlRequest(viewerId);

      const participant = resolveParticipantFromViewerId(viewerId);
      if (!participant) {
        // Without a participant row we cannot persist control_state, and
        // host-side injection keys off that row — so signalling the viewer
        // alone would hand them a session that silently drops every event.
        console.warn('[CapturePreview] Cannot approve control: no participant for viewer', {
          viewerId,
        });
        await refreshSession();
        return;
      }

      await handleGrantControl(participant.id);
    },
    [dismissControlRequest, resolveParticipantFromViewerId, handleGrantControl, refreshSession]
  );

  const handleDenyControlRequest = useCallback(
    (viewerId: string) => {
      dismissControlRequest(viewerId);
      // Tell the viewer so their UI leaves the "requested" state.
      revokeControl(viewerId);
    },
    [dismissControlRequest, revokeControl]
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

              {/*
                Participant volume. This goes above 1.0, which a media element
                cannot do on its own — it drives the gain stage in front of
                playback, so a quiet talker can actually be made louder rather
                than only muted.
              */}
              <label
                className="flex items-center gap-2 text-xs text-muted-foreground"
                title="Volume of other participants"
              >
                <span className="sr-only">Participant volume</span>
                <input
                  type="range"
                  min={MIN_REMOTE_AUDIO_GAIN}
                  max={MAX_REMOTE_AUDIO_GAIN}
                  step={0.1}
                  value={speakerGain}
                  disabled={speakerMuted}
                  onChange={(event) => {
                    setSpeakerGain(clampAudioGain(Number(event.target.value)));
                  }}
                  className="w-24 accent-primary disabled:opacity-50"
                  aria-label="Participant volume"
                />
                <span className="w-9 tabular-nums">
                  {Math.round((speakerGain / DEFAULT_REMOTE_AUDIO_GAIN) * 100)}%
                </span>
              </label>
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

        {pendingControlRequests.map((request) => {
          const participant = resolveParticipantFromViewerId(request.viewerId);
          const name = participant?.display_name ?? 'A participant';

          return (
            <div
              key={request.viewerId}
              className="rounded-lg border border-blue-300/60 bg-blue-50 px-4 py-3 text-sm text-blue-950"
              data-testid="control-request-prompt"
            >
              <div className="flex items-start gap-2">
                <Monitor className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="font-medium">{name} wants to control your screen</div>
                  <div className="text-blue-900/90">
                    They will be able to move your cursor and type on this machine. Press
                    Ctrl+Shift+Esc at any time to cut control off immediately.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        void handleApproveControlRequest(request.viewerId);
                      }}
                    >
                      Allow control
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        handleDenyControlRequest(request.viewerId);
                      }}
                    >
                      Deny
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

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
                    PairUX uses KDE&apos;s approved Remote Desktop portal. When control is granted,
                    KDE must approve the request before any guest input can reach the host.
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
                    return (
                      <>
                        Backend: {inputDiagnostics.backend}
                        {' | '}portalDesktop:{' '}
                        {portalDesktop == null ? 'n/a' : String(portalDesktop)}
                      </>
                    );
                  })()}
                </div>
                <div className="space-y-1 rounded border border-amber-300/50 bg-white/70 p-2 font-mono text-xs">
                  {(() => {
                    const details = inputDiagnostics.details as
                      | {
                          currentDesktop?: string;
                          portalImplDetected?: string | null;
                          portal?: {
                            details?: {
                              currentDesktop?: string;
                              portalImplDetected?: string | null;
                            };
                          };
                        }
                      | undefined;

                    const currentDesktop =
                      details?.currentDesktop ?? details?.portal?.details?.currentDesktop;
                    const portalImplDetected =
                      details?.portalImplDetected ?? details?.portal?.details?.portalImplDetected;

                    return (
                      <>
                        <div>Portal status (auto-detected)</div>
                        <div>backend={inputDiagnostics.backend}</div>
                        <div>desktop={currentDesktop ?? 'n/a'}</div>
                        <div>portalImpl={portalImplDetected ?? 'n/a'}</div>
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
