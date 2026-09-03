/**
 * WebRTC Host Hook for React Native
 *
 * Port of apps/desktop/src/renderer/hooks/useWebRTCHostAPI.ts
 * adapted for React Native:
 *  - Auth token from secure-storage (not Electron IPC)
 *  - SSE via react-native-sse (not browser EventSource)
 *  - RTCPeerConnection from react-native-webrtc
 *  - No HTMLAudioElement (audio handled by RN WebRTC)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { MediaStreamTrack, RTCRtpSender } from 'react-native-webrtc';
import { RTCPeerConnection, RTCIceCandidate, MediaStream, mediaDevices } from 'react-native-webrtc';
import type {
  ConnectionState,
  NetworkQuality,
  InputMessage,
  ControlMessage,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';
import {
  MOBILE_VOICE_AUDIO_CONSTRAINTS,
  prioritizeAudioSender,
  tuneOpusForVoice,
  markTrackAsSpeech,
} from '@pairux/shared-types';
import { API_BASE_URL } from '../config';
import {
  isAndroidNativePromptActive,
  subscribeAndroidNativePrompt,
} from '../lib/android-native-prompt';
import { getStoredAuth, isAuthExpired } from '../lib/secure-storage';
import { createEventSource, type SSEConnection } from '../lib/event-source';

// RN WebRTC's RTCDataChannel type (differs from browser global)
type DataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;

// react-native-webrtc's exported MediaTrackConstraints type only declares the
// video fields, but its native layer forwards every audio key verbatim to
// createAudioSource. Requesting echo cancellation therefore means going around
// the published type — hence the assertion, isolated here rather than at the
// call site.
const voiceCaptureConstraints = {
  audio: MOBILE_VOICE_AUDIO_CONSTRAINTS,
  video: false,
} as unknown as Parameters<typeof mediaDevices.getUserMedia>[0];

// Local type for createOffer/createAnswer results (not re-exported from react-native-webrtc)
interface OfferAnswer {
  type: string | null;
  sdp: string;
}

// Adaptive bitrate presets
interface BitratePreset {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

const _BITRATE_PRESETS: Record<NetworkQuality, BitratePreset> = {
  excellent: { maxBitrate: 8_000_000, scaleResolutionDownBy: 1, maxFramerate: 60 },
  good: { maxBitrate: 4_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  poor: { maxBitrate: 1_500_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  bad: { maxBitrate: 600_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
};

const STATS_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 75000;
const HEARTBEAT_WATCHDOG_INTERVAL = 15000;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface ViewerConnection {
  id: string;
  peerConnection: RTCPeerConnection;
  dataChannel: DataChannel | null;
  connectionState: ConnectionState;
  controlState: 'view-only' | 'requested' | 'granted';
  networkQuality: NetworkQuality;
  currentPreset: NetworkQuality;
  audioTrack: MediaStreamTrack | null;
  isMuted: boolean;
}

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  senderId: string;
  targetId?: string;
  timestamp: number;
}

interface UseWebRTCHostOptions {
  sessionId: string;
  hostId: string;
  allowControl?: boolean;
  onViewerJoined?: (viewerId: string) => void;
  onViewerLeft?: (viewerId: string) => void;
  onControlRequest?: (viewerId: string) => void;
  onInputReceived?: (viewerId: string, input: InputMessage) => void;
}

interface UseWebRTCHostReturn {
  isHosting: boolean;
  viewerCount: number;
  viewers: Map<string, ViewerConnection>;
  controllingViewer: string | null;
  error: string | null;
  startHosting: () => Promise<void>;
  stopHosting: () => void;
  publishStream: (stream: MediaStream) => Promise<void>;
  unpublishStream: () => Promise<void>;
  grantControl: (viewerId: string) => void;
  revokeControl: (viewerId: string) => void;
  kickViewer: (viewerId: string) => void;
  muteViewer: (viewerId: string, muted: boolean) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

export function useWebRTCHost({
  sessionId,
  hostId,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
}: UseWebRTCHostOptions): UseWebRTCHostReturn {
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [controllingViewer, setControllingViewer] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const eventSourceRef = useRef<SSEConnection | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeartbeatAtRef = useRef(0);
  const removeViewerRef = useRef<((viewerId: string) => void) | undefined>(undefined);
  const authTokenRef = useRef<string | null>(null);
  const isStartingRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const resumeOnActiveRef = useRef(false);
  const deferredBackgroundRef = useRef(false);
  const micEnabledIntentRef = useRef(true);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hostMicStreamRef = useRef<MediaStream | null>(null);
  const publishedStreamSendersRef = useRef<Map<string, Map<string, RTCRtpSender>>>(new Map());
  const publishedStreamVersionRef = useRef(0);

  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);
  const onViewerJoinedRef = useRef(onViewerJoined);
  const onViewerLeftRef = useRef(onViewerLeft);
  const startHostingRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const stopHostingRef = useRef<(() => void) | undefined>(undefined);
  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;
  onViewerJoinedRef.current = onViewerJoined;
  onViewerLeftRef.current = onViewerLeft;

  const isCurrentGeneration = useCallback(
    (generation: number) => mountedRef.current && generationRef.current === generation,
    []
  );

  // Send signal via API
  const sendSignal = useCallback(
    async (signal: SignalMessage): Promise<boolean> => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authTokenRef.current) {
          headers.Authorization = `Bearer ${authTokenRef.current}`;
        }

        const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/signal`, {
          method: 'POST',
          headers,
          body: JSON.stringify(signal),
        });

        if (!response.ok) {
          console.error('[WebRTCHost] Failed to send signal:', await response.text());
          return false;
        }
        return true;
      } catch (err) {
        console.error('[WebRTCHost] Error sending signal:', err);
        return false;
      }
    },
    [sessionId]
  );

  const renegotiateViewer = useCallback(
    async (viewer: ViewerConnection, generation: number): Promise<void> => {
      if (!isCurrentGeneration(generation) || viewersRef.current.get(viewer.id) !== viewer) {
        return;
      }

      const offer = (await viewer.peerConnection.createOffer({})) as OfferAnswer;
      if (!isCurrentGeneration(generation) || viewersRef.current.get(viewer.id) !== viewer) {
        return;
      }
      if (offer.sdp) {
        offer.sdp = tuneOpusForVoice(offer.sdp);
      }
      await viewer.peerConnection.setLocalDescription(offer);
      if (!isCurrentGeneration(generation) || viewersRef.current.get(viewer.id) !== viewer) {
        return;
      }

      if (!offer.sdp) {
        throw new Error(`Failed to create an SDP offer for viewer ${viewer.id}`);
      }

      const sent = await sendSignal({
        type: 'offer',
        sdp: offer.sdp,
        senderId: hostId,
        targetId: viewer.id,
        timestamp: Date.now(),
      });
      if (!sent) {
        throw new Error(`Failed to signal viewer ${viewer.id}`);
      }
    },
    [hostId, isCurrentGeneration, sendSignal]
  );

  // Report usage stats
  const reportStats = useCallback(
    async (generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      for (const viewer of viewersRef.current.values()) {
        if (!isCurrentGeneration(generation)) return;
        if (viewer.connectionState !== 'connected') continue;

        try {
          const stats = (await viewer.peerConnection.getStats()) as Map<
            string,
            Record<string, unknown>
          >;
          if (!isCurrentGeneration(generation) || viewersRef.current.get(viewer.id) !== viewer) {
            return;
          }
          let bytesSent = 0;
          let bytesReceived = 0;
          let packetsSent = 0;
          let packetsReceived = 0;
          let packetsLost = 0;
          let roundTripTime: number | undefined;
          let frameRate: number | undefined;
          let frameWidth: number | undefined;
          let frameHeight: number | undefined;

          stats.forEach((report: Record<string, unknown>) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              bytesSent += (report.bytesSent as number | undefined) ?? 0;
              packetsSent += (report.packetsSent as number | undefined) ?? 0;
              frameRate = report.framesPerSecond as number | undefined;
              frameWidth = report.frameWidth as number | undefined;
              frameHeight = report.frameHeight as number | undefined;
            }
            if (report.type === 'inbound-rtp') {
              bytesReceived += (report.bytesReceived as number | undefined) ?? 0;
              packetsReceived += (report.packetsReceived as number | undefined) ?? 0;
            }
            if (report.type === 'remote-inbound-rtp') {
              packetsLost += (report.packetsLost as number | undefined) ?? 0;
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              roundTripTime = ((report.currentRoundTripTime as number | undefined) ?? 0) * 1000;
            }
          });

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (authTokenRef.current) {
            headers.Authorization = `Bearer ${authTokenRef.current}`;
          }

          await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/stats`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              participantId: hostId,
              role: 'host',
              timestamp: Date.now(),
              connectionState: viewer.connectionState,
              bytesSent,
              bytesReceived,
              packetsSent,
              packetsReceived,
              packetsLost,
              roundTripTime,
              frameRate,
              frameWidth,
              frameHeight,
              reportInterval: STATS_INTERVAL,
            }),
          });
        } catch (err) {
          console.error('[WebRTCHost] Failed to report stats:', err);
        }
      }
    },
    [hostId, isCurrentGeneration, sessionId]
  );

  // Handle data channel messages from viewer
  const handleDataChannelMessage = useCallback((viewerId: string, data: string) => {
    try {
      const message = JSON.parse(data) as ControlMessage | InputMessage;

      if ('type' in message) {
        switch (message.type) {
          case 'control-request':
            onControlRequestRef.current?.(viewerId);
            break;
          case 'control-revoke': {
            const viewer = viewersRef.current.get(viewerId);
            if (viewer) {
              viewer.controlState = 'view-only';
              setViewers(new Map(viewersRef.current));
              setControllingViewer((prev) => (prev === viewerId ? null : prev));
            }
            break;
          }
          case 'input':
            onInputReceivedRef.current?.(viewerId, message);
            break;
        }
      }
    } catch {
      // Invalid message
    }
  }, []);

  // Relay audio to other viewers
  const relayAudioToOtherViewers = useCallback(
    async (sourceViewerId: string, audioTrack: MediaStreamTrack, generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      const audioStream = new MediaStream([audioTrack]);

      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        if (!isCurrentGeneration(generation)) return;
        if (otherId === sourceViewerId) continue;
        if (
          otherViewer.connectionState !== 'connected' &&
          otherViewer.connectionState !== 'connecting'
        )
          continue;

        try {
          await prioritizeAudioSender(otherViewer.peerConnection.addTrack(audioTrack, audioStream));
          if (!isCurrentGeneration(generation)) return;

          const offer = (await otherViewer.peerConnection.createOffer({})) as OfferAnswer;
          if (!isCurrentGeneration(generation)) return;
          // In-band FEC turns a lost packet into a duller syllable, not a gap.
          if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
          await otherViewer.peerConnection.setLocalDescription(offer);
          if (!isCurrentGeneration(generation)) return;

          if (offer.sdp) {
            await sendSignal({
              type: 'offer',
              sdp: offer.sdp,
              senderId: hostId,
              targetId: otherId,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.error(`[WebRTCHost] Failed to relay audio to ${otherId}:`, err);
        }
      }
    },
    [hostId, isCurrentGeneration, sendSignal]
  );

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    (viewerId: string, generation: number): RTCPeerConnection => {
      console.log('[WebRTCHost] Creating peer connection for viewer:', viewerId);

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceCandidatePoolSize: 10,
      });
      const publishedSenders = new Map<string, RTCRtpSender>();
      publishedStreamSendersRef.current.set(viewerId, publishedSenders);

      // Add local stream tracks
      const currentStream = localStreamRef.current;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, currentStream);
          publishedSenders.set(track.kind, sender);
        });
      }

      // Add host mic
      const hostMic = hostMicStreamRef.current;
      if (hostMic) {
        hostMic.getAudioTracks().forEach((track) => {
          void prioritizeAudioSender(pc.addTrack(track, hostMic));
        });
      }

      // Handle incoming audio from viewer
      pc.addEventListener('track', (event) => {
        if (
          !isCurrentGeneration(generation) ||
          viewersRef.current.get(viewerId)?.peerConnection !== pc
        ) {
          return;
        }
        const track = event.track;
        if (track?.kind === 'audio') {
          console.log(`[WebRTCHost] Received audio track from viewer: ${viewerId}`);
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            viewer.audioTrack = track;
            setViewers(new Map(viewersRef.current));
            void relayAudioToOtherViewers(viewerId, track, generation);
          }
        }
      });

      // Handle ICE candidates
      pc.addEventListener('icecandidate', (event) => {
        if (
          !isCurrentGeneration(generation) ||
          viewersRef.current.get(viewerId)?.peerConnection !== pc
        ) {
          return;
        }
        if (event.candidate) {
          void sendSignal({
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            senderId: hostId,
            targetId: viewerId,
            timestamp: Date.now(),
          });
        }
      });

      // Handle connection state changes
      pc.addEventListener('connectionstatechange', () => {
        if (
          !isCurrentGeneration(generation) ||
          viewersRef.current.get(viewerId)?.peerConnection !== pc
        ) {
          return;
        }
        const viewer = viewersRef.current.get(viewerId);
        if (viewer) {
          let newState: ConnectionState;
          switch (pc.connectionState) {
            case 'connecting':
              newState = 'connecting';
              break;
            case 'connected':
              newState = 'connected';
              break;
            case 'disconnected':
              newState = 'reconnecting';
              break;
            case 'failed':
              newState = 'failed';
              break;
            case 'closed':
              newState = 'disconnected';
              break;
            default:
              newState = 'idle';
          }

          viewer.connectionState = newState;
          setViewers(new Map(viewersRef.current));

          if (pc.connectionState === 'connected') {
            // Re-apply audio priority now that negotiation is done. Some
            // stacks report no encodings on a sender until then, which would
            // have made the call made at addTrack() time a silent no-op.
            for (const sender of pc.getSenders()) {
              if (sender.track?.kind === 'audio') {
                void prioritizeAudioSender(sender);
              }
            }
          }

          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            removeViewerRef.current?.(viewerId);
          }
        }
      });

      // Create data channel for control messages
      const dc = pc.createDataChannel('control', { ordered: true });

      dc.addEventListener('open', () => {
        if (
          !isCurrentGeneration(generation) ||
          viewersRef.current.get(viewerId)?.peerConnection !== pc
        ) {
          return;
        }
        const viewer = viewersRef.current.get(viewerId);
        if (viewer) {
          viewer.dataChannel = dc;
          setViewers(new Map(viewersRef.current));
        }
      });

      dc.addEventListener('close', () => {
        if (
          !isCurrentGeneration(generation) ||
          viewersRef.current.get(viewerId)?.peerConnection !== pc
        ) {
          return;
        }
        const viewer = viewersRef.current.get(viewerId);
        if (viewer) {
          viewer.dataChannel = null;
          viewer.controlState = 'view-only';
          setViewers(new Map(viewersRef.current));
          setControllingViewer((prev) => (prev === viewerId ? null : prev));
        }
      });

      dc.addEventListener('message', (event) => {
        if (
          !isCurrentGeneration(generation) ||
          viewersRef.current.get(viewerId)?.peerConnection !== pc
        ) {
          return;
        }
        handleDataChannelMessage(viewerId, typeof event.data === 'string' ? event.data : '');
      });

      return pc;
    },
    [hostId, handleDataChannelMessage, isCurrentGeneration, sendSignal, relayAudioToOtherViewers]
  );

  // Remove viewer
  const removeViewer = useCallback((viewerId: string) => {
    const viewer = viewersRef.current.get(viewerId);
    if (viewer) {
      console.log('[WebRTCHost] Removing viewer:', viewerId);
      viewer.peerConnection.close();
      viewersRef.current.delete(viewerId);
      publishedStreamSendersRef.current.delete(viewerId);
      pendingCandidatesRef.current.delete(viewerId);
      setViewers(new Map(viewersRef.current));
      if (mountedRef.current) {
        onViewerLeftRef.current?.(viewerId);
      }
    }
  }, []);

  removeViewerRef.current = removeViewer;

  // Handle viewer joining
  const handleViewerJoin = useCallback(
    async (viewerId: string, generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      if (viewerId === hostId) return;
      if (viewersRef.current.has(viewerId)) return;

      console.log('[WebRTCHost] Viewer joining:', viewerId);

      const pc = createPeerConnection(viewerId, generation);

      const viewer: ViewerConnection = {
        id: viewerId,
        peerConnection: pc,
        dataChannel: null,
        connectionState: 'connecting',
        controlState: 'view-only',
        networkQuality: 'good',
        currentPreset: 'good',
        audioTrack: null,
        isMuted: false,
      };

      viewersRef.current.set(viewerId, viewer);
      setViewers(new Map(viewersRef.current));
      onViewerJoinedRef.current?.(viewerId);

      try {
        const offer = (await pc.createOffer({})) as OfferAnswer;
        if (!isCurrentGeneration(generation) || viewersRef.current.get(viewerId) !== viewer) return;
        // In-band FEC turns a lost packet into a duller syllable, not a gap.
        if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
        await pc.setLocalDescription(offer);
        if (!isCurrentGeneration(generation) || viewersRef.current.get(viewerId) !== viewer) return;

        if (offer.sdp) {
          await sendSignal({
            type: 'offer',
            sdp: offer.sdp,
            senderId: hostId,
            targetId: viewerId,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('[WebRTCHost] Failed to create offer:', err);
        if (isCurrentGeneration(generation)) {
          removeViewer(viewerId);
        }
      }
    },
    [hostId, createPeerConnection, isCurrentGeneration, removeViewer, sendSignal]
  );

  // Handle incoming signals
  const handleSignalMessage = useCallback(
    async (signal: SignalMessage, generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      if (signal.targetId && signal.targetId !== hostId) return;

      const viewerId = signal.senderId;

      switch (signal.type) {
        case 'answer': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && signal.sdp) {
            if (viewer.peerConnection.signalingState !== 'have-local-offer') {
              console.warn(
                `[WebRTCHost] Ignoring answer from ${viewerId} — signaling state is ${viewer.peerConnection.signalingState}`
              );
              break;
            }
            await viewer.peerConnection.setRemoteDescription({
              type: 'answer',
              sdp: signal.sdp,
            });
            if (!isCurrentGeneration(generation) || viewersRef.current.get(viewerId) !== viewer) {
              return;
            }

            // Drain buffered ICE candidates
            const pending = pendingCandidatesRef.current.get(viewerId);
            if (pending && pending.length > 0) {
              pendingCandidatesRef.current.delete(viewerId);
              for (const candidate of pending) {
                await viewer.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                if (
                  !isCurrentGeneration(generation) ||
                  viewersRef.current.get(viewerId) !== viewer
                ) {
                  return;
                }
              }
            }
          }
          break;
        }

        case 'ice-candidate': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && signal.candidate?.candidate) {
            if (!viewer.peerConnection.remoteDescription) {
              const pending = pendingCandidatesRef.current.get(viewerId) ?? [];
              pending.push(signal.candidate);
              pendingCandidatesRef.current.set(viewerId, pending);
            } else {
              await viewer.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
          }
          break;
        }
      }
    },
    [hostId, isCurrentGeneration]
  );

  // Toggle host microphone
  const toggleMic = useCallback(() => {
    const micStream = hostMicStreamRef.current;
    if (!micStream) return;

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) return;

    const newEnabled = !micEnabledIntentRef.current;
    micEnabledIntentRef.current = newEnabled;
    tracks.forEach((track) => {
      track.enabled = newEnabled;
    });
    setMicEnabled(newEnabled);
  }, []);

  // Start hosting
  const startHosting = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }
    if (appStateRef.current !== 'active') {
      resumeOnActiveRef.current = true;
      return;
    }
    if (isStartingRef.current || eventSourceRef.current) {
      return;
    }

    const generation = ++generationRef.current;
    isStartingRef.current = true;

    console.log('[WebRTCHost] Starting hosting for session:', sessionId);

    // Get auth token from secure storage
    try {
      const stored = await getStoredAuth();
      if (!isCurrentGeneration(generation)) return;
      if (!stored || isAuthExpired(stored)) {
        isStartingRef.current = false;
        setError('Not authenticated. Please log in again.');
        return;
      }
      authTokenRef.current = stored.accessToken;
    } catch (err) {
      console.error('[WebRTCHost] Failed to get auth token:', err);
      if (isCurrentGeneration(generation)) {
        isStartingRef.current = false;
        setError('Failed to authenticate. Please log in again.');
      }
      return;
    }

    // Capture host microphone
    try {
      const micStream = await mediaDevices.getUserMedia(voiceCaptureConstraints);
      if (!isCurrentGeneration(generation)) {
        micStream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      const audioTrack = micStream.getAudioTracks()[0];
      markTrackAsSpeech(audioTrack);
      micStream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabledIntentRef.current;
      });
      hostMicStreamRef.current = micStream;
      setHasMic(true);
      setMicEnabled(micEnabledIntentRef.current);
    } catch {
      if (!isCurrentGeneration(generation)) return;
      console.warn('[WebRTCHost] No microphone available');
      setHasMic(false);
      setMicEnabled(false);
    }

    // Build SSE URL
    const sseParams = new URLSearchParams({
      participantId: hostId,
    });
    if (authTokenRef.current) {
      sseParams.set('token', authTokenRef.current);
    }

    const sseUrl = `${API_BASE_URL}/api/sessions/${sessionId}/signal/stream?${sseParams.toString()}`;
    const eventSource = createEventSource(sseUrl);
    if (!isCurrentGeneration(generation)) {
      eventSource.close();
      return;
    }
    eventSourceRef.current = eventSource;
    lastHeartbeatAtRef.current = Date.now();

    const isCurrentEventSource = () =>
      isCurrentGeneration(generation) && eventSourceRef.current === eventSource;

    eventSource.addEventListener('connected', (event) => {
      if (!isCurrentEventSource()) return;
      console.log('[WebRTCHost] SSE connected');
      lastHeartbeatAtRef.current = Date.now();
      isStartingRef.current = false;
      setIsHosting(true);
      setError(null);

      try {
        const data = JSON.parse(event.data) as { iceServers?: RTCIceServer[] };
        if (data.iceServers && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers;
        }
      } catch {
        // Use default ICE servers
      }
    });

    eventSource.addEventListener('heartbeat', () => {
      if (!isCurrentEventSource()) return;
      lastHeartbeatAtRef.current = Date.now();
    });

    eventSource.addEventListener('signal', (event) => {
      if (!isCurrentEventSource()) return;
      try {
        const signal = JSON.parse(event.data) as SignalMessage;
        void handleSignalMessage(signal, generation);
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse signal:', err);
      }
    });

    eventSource.addEventListener('presence-join', (event) => {
      if (!isCurrentEventSource()) return;
      try {
        const { presences } = JSON.parse(event.data) as {
          presences: { user_id: string; role: string }[];
        };
        for (const presence of presences) {
          if (presence.role === 'viewer' && presence.user_id !== hostId) {
            void handleViewerJoin(presence.user_id, generation);
          }
        }
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse presence:', err);
      }
    });

    eventSource.addEventListener('presence-leave', (event) => {
      if (!isCurrentEventSource()) return;
      try {
        const { presences } = JSON.parse(event.data) as {
          presences: { user_id: string }[];
        };
        for (const presence of presences) {
          removeViewer(presence.user_id);
        }
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse presence leave:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      if (!isCurrentEventSource()) return;
      console.error('[WebRTCHost] SSE error');
      isStartingRef.current = false;
      setError('Connection to server lost. Reconnecting...');
    });

    // Start stats reporting
    statsIntervalRef.current = setInterval(() => {
      void reportStats(generation);
    }, STATS_INTERVAL);
    heartbeatWatchdogRef.current = setInterval(() => {
      if (!isCurrentEventSource()) return;
      if (Date.now() - lastHeartbeatAtRef.current <= HEARTBEAT_TIMEOUT) return;

      setError('Connection heartbeat timed out. Reconnecting...');
      stopHostingRef.current?.();
      void startHostingRef.current?.();
    }, HEARTBEAT_WATCHDOG_INTERVAL);
  }, [
    sessionId,
    hostId,
    handleSignalMessage,
    handleViewerJoin,
    isCurrentGeneration,
    removeViewer,
    reportStats,
  ]);

  startHostingRef.current = startHosting;

  // Stop hosting
  const stopHosting = useCallback(() => {
    console.log('[WebRTCHost] Stopping hosting');
    generationRef.current += 1;
    isStartingRef.current = false;

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (heartbeatWatchdogRef.current) {
      clearInterval(heartbeatWatchdogRef.current);
      heartbeatWatchdogRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    viewersRef.current.forEach((viewer) => {
      viewer.peerConnection.close();
    });
    viewersRef.current.clear();
    publishedStreamSendersRef.current.clear();
    pendingCandidatesRef.current.clear();
    publishedStreamVersionRef.current += 1;
    localStreamRef.current = null;

    if (hostMicStreamRef.current) {
      hostMicStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      hostMicStreamRef.current = null;
    }
    lastHeartbeatAtRef.current = 0;

    if (mountedRef.current) {
      setViewers(new Map());
      setControllingViewer(null);
      setIsHosting(false);
      setMicEnabled(false);
      setHasMic(false);
    }
  }, []);

  stopHostingRef.current = stopHosting;

  const removePublishedSenders = useCallback((viewer: ViewerConnection): boolean => {
    const publishedSenders = publishedStreamSendersRef.current.get(viewer.id);
    if (!publishedSenders || publishedSenders.size === 0) {
      return false;
    }

    for (const sender of publishedSenders.values()) {
      viewer.peerConnection.removeTrack(sender);
    }
    publishedSenders.clear();
    return true;
  }, []);

  // Publish screen share stream
  const publishStream = useCallback(
    async (stream: MediaStream) => {
      const generation = generationRef.current;
      if (!isCurrentGeneration(generation)) return;

      localStreamRef.current = stream;
      const publishVersion = ++publishedStreamVersionRef.current;

      try {
        for (const viewer of viewersRef.current.values()) {
          if (
            !isCurrentGeneration(generation) ||
            publishedStreamVersionRef.current !== publishVersion ||
            localStreamRef.current !== stream
          ) {
            return;
          }
          if (viewer.connectionState !== 'connected' && viewer.connectionState !== 'connecting') {
            continue;
          }

          let publishedSenders = publishedStreamSendersRef.current.get(viewer.id);
          if (!publishedSenders) {
            publishedSenders = new Map();
            publishedStreamSendersRef.current.set(viewer.id, publishedSenders);
          }

          const desiredTracks = new Map(stream.getTracks().map((track) => [track.kind, track]));
          let negotiationNeeded = false;

          for (const [kind, sender] of publishedSenders) {
            const desiredTrack = desiredTracks.get(kind);
            if (!desiredTrack || sender.track !== desiredTrack) {
              viewer.peerConnection.removeTrack(sender);
              publishedSenders.delete(kind);
              negotiationNeeded = true;
            }
          }

          for (const track of desiredTracks.values()) {
            if (!publishedSenders.has(track.kind)) {
              const sender = viewer.peerConnection.addTrack(track, stream);
              publishedSenders.set(track.kind, sender);
              negotiationNeeded = true;
            }
          }

          if (negotiationNeeded) {
            await renegotiateViewer(viewer, generation);
          }
        }
      } catch (publishError) {
        if (
          isCurrentGeneration(generation) &&
          publishedStreamVersionRef.current === publishVersion &&
          localStreamRef.current === stream
        ) {
          localStreamRef.current = null;
          publishedStreamVersionRef.current += 1;

          for (const viewer of viewersRef.current.values()) {
            if (!isCurrentGeneration(generation)) return;
            if (!removePublishedSenders(viewer)) continue;
            try {
              await renegotiateViewer(viewer, generation);
            } catch (rollbackError) {
              console.error(
                `[WebRTCHost] Failed to roll back stream for ${viewer.id}:`,
                rollbackError
              );
            }
          }
        }
        throw publishError;
      }
    },
    [isCurrentGeneration, removePublishedSenders, renegotiateViewer]
  );

  // Unpublish stream
  const unpublishStream = useCallback(async () => {
    const generation = generationRef.current;
    if (!isCurrentGeneration(generation)) return;

    localStreamRef.current = null;
    const unpublishVersion = ++publishedStreamVersionRef.current;
    const failures: string[] = [];

    for (const viewer of viewersRef.current.values()) {
      if (
        !isCurrentGeneration(generation) ||
        publishedStreamVersionRef.current !== unpublishVersion
      ) {
        return;
      }
      if (viewer.connectionState !== 'connected' && viewer.connectionState !== 'connecting') {
        continue;
      }

      try {
        if (removePublishedSenders(viewer)) {
          await renegotiateViewer(viewer, generation);
        }
      } catch (unpublishError) {
        failures.push(viewer.id);
        console.error(`[WebRTCHost] Failed to unpublish stream from ${viewer.id}:`, unpublishError);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Failed to unpublish screen share from ${String(failures.length)} viewer(s)`);
    }
  }, [isCurrentGeneration, removePublishedSenders, renegotiateViewer]);

  // Suspend native media and transport while backgrounded, then restore one
  // fresh host connection only if hosting was active or starting beforehand.
  useEffect(() => {
    mountedRef.current = true;
    appStateRef.current = AppState.currentState;

    const suspendForBackground = () => {
      const hadActiveHost =
        isStartingRef.current || eventSourceRef.current !== null || viewersRef.current.size > 0;
      resumeOnActiveRef.current = resumeOnActiveRef.current || hadActiveHost;
      if (hadActiveHost) {
        stopHosting();
      }
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background') {
        if (previousState !== 'background') {
          if (isAndroidNativePromptActive()) {
            deferredBackgroundRef.current = true;
          } else {
            suspendForBackground();
          }
        }
        return;
      }

      if (nextState === 'active') {
        deferredBackgroundRef.current = false;
        if (previousState !== 'active' && resumeOnActiveRef.current) {
          resumeOnActiveRef.current = false;
          void startHostingRef.current?.();
        }
      }
    });
    const unsubscribePrompt = subscribeAndroidNativePrompt((active) => {
      if (!active && deferredBackgroundRef.current && appStateRef.current === 'background') {
        deferredBackgroundRef.current = false;
        suspendForBackground();
      }
    });

    return () => {
      subscription.remove();
      unsubscribePrompt();
      mountedRef.current = false;
      resumeOnActiveRef.current = false;
      deferredBackgroundRef.current = false;
      stopHosting();
    };
  }, [stopHosting]);

  // Grant control
  const grantControl = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer?.dataChannel?.readyState !== 'open') return;

      if (controllingViewer && controllingViewer !== viewerId) {
        const prevViewer = viewersRef.current.get(controllingViewer);
        if (prevViewer?.dataChannel?.readyState === 'open') {
          const revokeMessage: ControlMessage = {
            type: 'control-revoke',
            participantId: controllingViewer,
            timestamp: Date.now(),
          };
          prevViewer.dataChannel.send(JSON.stringify(revokeMessage));
          prevViewer.controlState = 'view-only';
        }
      }

      const grantMessage: ControlMessage = {
        type: 'control-grant',
        participantId: viewerId,
        timestamp: Date.now(),
      };
      viewer.dataChannel.send(JSON.stringify(grantMessage));
      viewer.controlState = 'granted';
      setControllingViewer(viewerId);
      setViewers(new Map(viewersRef.current));
    },
    [controllingViewer]
  );

  // Revoke control
  const revokeControl = useCallback((viewerId: string) => {
    const viewer = viewersRef.current.get(viewerId);
    if (viewer?.dataChannel?.readyState !== 'open') return;

    const message: ControlMessage = {
      type: 'control-revoke',
      participantId: viewerId,
      timestamp: Date.now(),
    };
    viewer.dataChannel.send(JSON.stringify(message));
    viewer.controlState = 'view-only';
    setControllingViewer((prev) => (prev === viewerId ? null : prev));
    setViewers(new Map(viewersRef.current));
  }, []);

  // Kick viewer
  const kickViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (!viewer) return;

      if (viewer.dataChannel?.readyState === 'open') {
        const message: KickMessage = { type: 'kick', timestamp: Date.now() };
        viewer.dataChannel.send(JSON.stringify(message));
      }

      if (controllingViewer === viewerId) {
        setControllingViewer(null);
      }
      removeViewer(viewerId);
    },
    [controllingViewer, removeViewer]
  );

  // Mute/unmute viewer
  const muteViewer = useCallback((viewerId: string, muted: boolean) => {
    const viewer = viewersRef.current.get(viewerId);
    if (!viewer) return;

    if (viewer.dataChannel?.readyState === 'open') {
      const message: MuteMessage = {
        type: 'mute',
        participantId: viewerId,
        muted,
        timestamp: Date.now(),
      };
      viewer.dataChannel.send(JSON.stringify(message));
    }

    viewer.isMuted = muted;
    setViewers(new Map(viewersRef.current));
  }, []);

  return {
    isHosting,
    viewerCount: viewers.size,
    viewers,
    controllingViewer,
    error,
    startHosting,
    stopHosting,
    publishStream,
    unpublishStream,
    grantControl,
    revokeControl,
    kickViewer,
    muteViewer,
    micEnabled,
    hasMic,
    toggleMic,
  };
}
