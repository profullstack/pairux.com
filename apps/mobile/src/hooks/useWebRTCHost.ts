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
import type { MediaStreamTrack } from 'react-native-webrtc';
import { RTCPeerConnection, RTCIceCandidate, MediaStream, mediaDevices } from 'react-native-webrtc';
import type {
  ConnectionState,
  NetworkQuality,
  InputMessage,
  CursorPositionMessage,
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
  localStream: MediaStream | null;
  allowControl?: boolean;
  onViewerJoined?: (viewerId: string) => void;
  onViewerLeft?: (viewerId: string) => void;
  onControlRequest?: (viewerId: string) => void;
  onInputReceived?: (viewerId: string, input: InputMessage) => void;
  onCursorUpdate?: (viewerId: string, cursor: CursorPositionMessage) => void;
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
  localStream,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
  onCursorUpdate,
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
  const removeViewerRef = useRef<((viewerId: string) => void) | undefined>(undefined);
  const authTokenRef = useRef<string | null>(null);
  const isStartingRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const hostMicStreamRef = useRef<MediaStream | null>(null);

  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  localStreamRef.current = localStream;
  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);
  const onCursorUpdateRef = useRef(onCursorUpdate);
  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;
  onCursorUpdateRef.current = onCursorUpdate;

  // Send signal via API
  const sendSignal = useCallback(
    async (signal: SignalMessage) => {
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
        }
      } catch (err) {
        console.error('[WebRTCHost] Error sending signal:', err);
      }
    },
    [sessionId]
  );

  // Report usage stats
  const reportStats = useCallback(async () => {
    for (const viewer of viewersRef.current.values()) {
      if (viewer.connectionState !== 'connected') continue;

      try {
        const stats = (await viewer.peerConnection.getStats()) as Map<
          string,
          Record<string, unknown>
        >;
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
  }, [sessionId, hostId]);

  // Handle data channel messages from viewer
  const handleDataChannelMessage = useCallback((viewerId: string, data: string) => {
    try {
      const message = JSON.parse(data) as ControlMessage | InputMessage | CursorPositionMessage;

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
          case 'cursor':
            onCursorUpdateRef.current?.(viewerId, message);
            break;
        }
      }
    } catch {
      // Invalid message
    }
  }, []);

  // Relay audio to other viewers
  const relayAudioToOtherViewers = useCallback(
    async (sourceViewerId: string, audioTrack: MediaStreamTrack) => {
      const audioStream = new MediaStream([audioTrack]);

      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        if (otherId === sourceViewerId) continue;
        if (
          otherViewer.connectionState !== 'connected' &&
          otherViewer.connectionState !== 'connecting'
        )
          continue;

        try {
          await prioritizeAudioSender(otherViewer.peerConnection.addTrack(audioTrack, audioStream));

          const offer = (await otherViewer.peerConnection.createOffer({})) as OfferAnswer;
          // In-band FEC turns a lost packet into a duller syllable, not a gap.
          if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
          await otherViewer.peerConnection.setLocalDescription(offer);

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
    [hostId, sendSignal]
  );

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    (viewerId: string): RTCPeerConnection => {
      console.log('[WebRTCHost] Creating peer connection for viewer:', viewerId);

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceCandidatePoolSize: 10,
      });

      // Add local stream tracks
      const currentStream = localStreamRef.current;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => {
          pc.addTrack(track, currentStream);
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
        const track = event.track;
        if (track?.kind === 'audio') {
          console.log(`[WebRTCHost] Received audio track from viewer: ${viewerId}`);
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            viewer.audioTrack = track;
            setViewers(new Map(viewersRef.current));
            void relayAudioToOtherViewers(viewerId, track);
          }
        }
      });

      // Handle ICE candidates
      pc.addEventListener('icecandidate', (event) => {
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
        const viewer = viewersRef.current.get(viewerId);
        if (viewer) {
          viewer.dataChannel = dc;
          setViewers(new Map(viewersRef.current));
        }
      });

      dc.addEventListener('close', () => {
        const viewer = viewersRef.current.get(viewerId);
        if (viewer) {
          viewer.dataChannel = null;
          viewer.controlState = 'view-only';
          setViewers(new Map(viewersRef.current));
          setControllingViewer((prev) => (prev === viewerId ? null : prev));
        }
      });

      dc.addEventListener('message', (event) => {
        handleDataChannelMessage(viewerId, typeof event.data === 'string' ? event.data : '');
      });

      return pc;
    },
    [hostId, handleDataChannelMessage, sendSignal, relayAudioToOtherViewers]
  );

  // Remove viewer
  const removeViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer) {
        console.log('[WebRTCHost] Removing viewer:', viewerId);
        viewer.peerConnection.close();
        viewersRef.current.delete(viewerId);
        pendingCandidatesRef.current.delete(viewerId);
        setViewers(new Map(viewersRef.current));
        onViewerLeft?.(viewerId);
      }
    },
    [onViewerLeft]
  );

  removeViewerRef.current = removeViewer;

  // Handle viewer joining
  const handleViewerJoin = useCallback(
    async (viewerId: string) => {
      if (viewerId === hostId) return;
      if (viewersRef.current.has(viewerId)) return;

      console.log('[WebRTCHost] Viewer joining:', viewerId);

      const pc = createPeerConnection(viewerId);

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
      onViewerJoined?.(viewerId);

      try {
        const offer = (await pc.createOffer({})) as OfferAnswer;
        // In-band FEC turns a lost packet into a duller syllable, not a gap.
        if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
        await pc.setLocalDescription(offer);

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
        removeViewer(viewerId);
      }
    },
    [hostId, createPeerConnection, onViewerJoined, removeViewer, sendSignal]
  );

  // Handle incoming signals
  const handleSignalMessage = useCallback(
    async (signal: SignalMessage) => {
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

            // Drain buffered ICE candidates
            const pending = pendingCandidatesRef.current.get(viewerId);
            if (pending && pending.length > 0) {
              pendingCandidatesRef.current.delete(viewerId);
              for (const candidate of pending) {
                await viewer.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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
    [hostId]
  );

  // Toggle host microphone
  const toggleMic = useCallback(() => {
    const micStream = hostMicStreamRef.current;
    if (!micStream) return;

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) return;

    const newEnabled = !micEnabled;
    tracks.forEach((track) => {
      track.enabled = newEnabled;
    });
    setMicEnabled(newEnabled);
  }, [micEnabled]);

  // Start hosting
  const startHosting = useCallback(async () => {
    if (isStartingRef.current || eventSourceRef.current) return;
    isStartingRef.current = true;

    console.log('[WebRTCHost] Starting hosting for session:', sessionId);

    // Get auth token from secure storage
    try {
      const stored = await getStoredAuth();
      if (!stored || isAuthExpired(stored)) {
        isStartingRef.current = false;
        setError('Not authenticated. Please log in again.');
        return;
      }
      authTokenRef.current = stored.accessToken;
    } catch (err) {
      console.error('[WebRTCHost] Failed to get auth token:', err);
      isStartingRef.current = false;
      setError('Failed to authenticate. Please log in again.');
      return;
    }

    // Capture host microphone
    try {
      const micStream = await mediaDevices.getUserMedia(voiceCaptureConstraints);
      markTrackAsSpeech(micStream.getAudioTracks()[0]);
      hostMicStreamRef.current = micStream;
      setHasMic(true);
      setMicEnabled(true);
    } catch {
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
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', (event) => {
      console.log('[WebRTCHost] SSE connected');
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

    eventSource.addEventListener('signal', (event) => {
      try {
        const signal = JSON.parse(event.data) as SignalMessage;
        void handleSignalMessage(signal);
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse signal:', err);
      }
    });

    eventSource.addEventListener('presence-join', (event) => {
      try {
        const { presences } = JSON.parse(event.data) as {
          presences: { user_id: string; role: string }[];
        };
        for (const presence of presences) {
          if (presence.role === 'viewer' && presence.user_id !== hostId) {
            void handleViewerJoin(presence.user_id);
          }
        }
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse presence:', err);
      }
    });

    eventSource.addEventListener('presence-leave', (event) => {
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
      console.error('[WebRTCHost] SSE error');
      isStartingRef.current = false;
      setError('Connection to server lost. Reconnecting...');
    });

    // Start stats reporting
    statsIntervalRef.current = setInterval(() => {
      void reportStats();
    }, STATS_INTERVAL);
  }, [sessionId, hostId, handleSignalMessage, handleViewerJoin, removeViewer, reportStats]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    console.log('[WebRTCHost] Stopping hosting');
    isStartingRef.current = false;

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    viewersRef.current.forEach((viewer) => {
      viewer.peerConnection.close();
    });
    viewersRef.current.clear();
    setViewers(new Map());
    setIsHosting(false);

    if (hostMicStreamRef.current) {
      hostMicStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      hostMicStreamRef.current = null;
    }
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  // Publish screen share stream
  const publishStream = useCallback(
    async (stream: MediaStream) => {
      localStreamRef.current = stream;

      for (const viewer of viewersRef.current.values()) {
        if (viewer.connectionState !== 'connected' && viewer.connectionState !== 'connecting')
          continue;

        try {
          stream.getTracks().forEach((track) => {
            viewer.peerConnection.addTrack(track, stream);
          });

          const offer = (await viewer.peerConnection.createOffer({})) as OfferAnswer;
          // In-band FEC turns a lost packet into a duller syllable, not a gap.
          if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
          await viewer.peerConnection.setLocalDescription(offer);

          if (offer.sdp) {
            await sendSignal({
              type: 'offer',
              sdp: offer.sdp,
              senderId: hostId,
              targetId: viewer.id,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.error(`[WebRTCHost] Failed to publish stream to ${viewer.id}:`, err);
        }
      }
    },
    [hostId, sendSignal]
  );

  // Unpublish stream
  const unpublishStream = useCallback(async () => {
    localStreamRef.current = null;

    for (const viewer of viewersRef.current.values()) {
      if (viewer.connectionState !== 'connected' && viewer.connectionState !== 'connecting')
        continue;

      try {
        const senders = viewer.peerConnection.getSenders();
        for (const sender of senders) {
          if (sender.track?.kind === 'video') {
            viewer.peerConnection.removeTrack(sender);
          }
        }

        const offer = (await viewer.peerConnection.createOffer({})) as OfferAnswer;
        // In-band FEC turns a lost packet into a duller syllable, not a gap.
        if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
        await viewer.peerConnection.setLocalDescription(offer);

        if (offer.sdp) {
          await sendSignal({
            type: 'offer',
            sdp: offer.sdp,
            senderId: hostId,
            targetId: viewer.id,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error(`[WebRTCHost] Failed to unpublish stream from ${viewer.id}:`, err);
      }
    }
  }, [hostId, sendSignal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);

  // Update stream when it changes
  useEffect(() => {
    if (!localStream || !isHosting) return;

    viewersRef.current.forEach((viewer) => {
      const senders = viewer.peerConnection.getSenders();
      localStream.getTracks().forEach((track) => {
        const existingSender = senders.find((s) => s.track?.kind === track.kind);
        if (existingSender) {
          void existingSender.replaceTrack(track);
        } else {
          viewer.peerConnection.addTrack(track, localStream);
        }
      });
    });
  }, [localStream, isHosting]);

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

      viewer.peerConnection.close();
      viewersRef.current.delete(viewerId);
      setViewers(new Map(viewersRef.current));
      onViewerLeft?.(viewerId);
    },
    [controllingViewer, onViewerLeft]
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
