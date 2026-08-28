/**
 * WebRTC Viewer Hook for React Native
 *
 * Port of apps/desktop/src/renderer/hooks/useWebRTCViewerAPI.ts
 * adapted for React Native:
 *  - Auth token from secure-storage (not Electron IPC)
 *  - SSE via react-native-sse (not browser EventSource)
 *  - RTCPeerConnection from react-native-webrtc
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { RTCPeerConnection, RTCIceCandidate, mediaDevices } from 'react-native-webrtc';
import type {
  ConnectionState,
  QualityMetrics,
  NetworkQuality,
  InputMessage,
  InputEvent,
  ControlMessage,
  ControlStateUI,
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

interface OfferAnswer {
  type: string | null;
  sdp: string;
}

const STATS_INTERVAL = 30000;
const STATS_DISPLAY_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 75000;
const HEARTBEAT_WATCHDOG_INTERVAL = 15000;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  senderId: string;
  targetId?: string;
  negotiationId?: string;
  timestamp: number;
}

interface UseWebRTCViewerOptions {
  sessionId: string;
  participantId: string;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnded?: () => void;
  onControlStateChange?: (state: ControlStateUI) => void;
  onKicked?: (reason?: string) => void;
}

interface UseWebRTCViewerReturn {
  connectionState: ConnectionState;
  remoteStream: MediaStream | null;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
  controlState: ControlStateUI;
  dataChannelReady: boolean;
  requestControl: () => void;
  releaseControl: () => void;
  sendInput: (event: InputEvent) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

export function useWebRTCViewer({
  sessionId,
  participantId,
  onStreamReady,
  onStreamEnded,
  onControlStateChange,
  onKicked,
}: UseWebRTCViewerOptions): UseWebRTCViewerReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | null>(null);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [error, setError] = useState<string | null>(null);
  const [controlState, setControlState] = useState<ControlStateUI>('view-only');
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<SSEConnection | null>(null);
  const dataChannelRef = useRef<DataChannel | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsReportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeartbeatAtRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const inputSequenceRef = useRef(0);
  const isConnectingRef = useRef(false);
  const connectionFailureInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const resumeOnActiveRef = useRef(false);
  const micEnabledIntentRef = useRef(true);
  const maxReconnectAttempts = 3;

  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve());

  const handleConnectionFailureRef = useRef<
    ((generation: number, pc: RTCPeerConnection) => Promise<void>) | undefined
  >(undefined);
  const onControlStateChangeRef = useRef(onControlStateChange);
  const onKickedRef = useRef(onKicked);
  const onStreamReadyRef = useRef(onStreamReady);
  const onStreamEndedRef = useRef(onStreamEnded);
  const disconnectRef = useRef<(() => void) | undefined>(undefined);
  const initializeRef = useRef<(() => Promise<void>) | undefined>(undefined);

  onControlStateChangeRef.current = onControlStateChange;
  onKickedRef.current = onKicked;
  onStreamReadyRef.current = onStreamReady;
  onStreamEndedRef.current = onStreamEnded;

  const isCurrentGeneration = useCallback(
    (generation: number) => mountedRef.current && generationRef.current === generation,
    []
  );

  const calculateNetworkQuality = useCallback((metrics: QualityMetrics): NetworkQuality => {
    const { packetLoss, roundTripTime } = metrics;
    if (packetLoss < 1 && roundTripTime < 50) return 'excellent';
    if (packetLoss < 3 && roundTripTime < 100) return 'good';
    if (packetLoss < 8 && roundTripTime < 200) return 'poor';
    return 'bad';
  }, []);

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
          console.error('[WebRTCViewer] Failed to send signal:', await response.text());
        }
      } catch (err) {
        console.error('[WebRTCViewer] Error sending signal:', err);
      }
    },
    [sessionId]
  );

  // Handle data channel messages
  const handleDataChannelMessage = useCallback((data: string) => {
    try {
      const message = JSON.parse(data) as ControlMessage | KickMessage | MuteMessage;

      if ('type' in message) {
        switch (message.type) {
          case 'control-grant':
            setControlState('granted');
            onControlStateChangeRef.current?.('granted');
            break;
          case 'control-revoke':
            setControlState('view-only');
            onControlStateChangeRef.current?.('view-only');
            break;
          case 'kick':
            setError('You were removed from the session');
            disconnectRef.current?.();
            onKickedRef.current?.(message.reason);
            break;
          case 'mute': {
            micEnabledIntentRef.current = !message.muted;
            const micStream = micStreamRef.current;
            if (micStream) {
              micStream.getAudioTracks().forEach((track) => {
                track.enabled = !message.muted;
              });
              setMicEnabled(!message.muted);
            }
            break;
          }
        }
      }
    } catch {
      // Invalid message
    }
  }, []);

  // Setup data channel
  const setupDataChannel = useCallback(
    (channel: DataChannel, generation: number) => {
      dataChannelRef.current = channel;

      const isCurrentChannel = () =>
        isCurrentGeneration(generation) && dataChannelRef.current === channel;

      channel.addEventListener('open', () => {
        if (!isCurrentChannel()) return;
        setDataChannelReady(true);
      });

      channel.addEventListener('close', () => {
        if (!isCurrentChannel()) return;
        setDataChannelReady(false);
        setControlState('view-only');
      });

      channel.addEventListener('error', () => {
        if (!isCurrentChannel()) return;
        setDataChannelReady(false);
      });

      channel.addEventListener('message', (event) => {
        if (!isCurrentChannel()) return;
        handleDataChannelMessage(typeof event.data === 'string' ? event.data : '');
      });
    },
    [handleDataChannelMessage, isCurrentGeneration]
  );

  // Control actions
  const requestControl = useCallback(() => {
    const dc = dataChannelRef.current;
    if (dc?.readyState !== 'open') return;

    setControlState('requested');
    onControlStateChangeRef.current?.('requested');

    const message: ControlMessage = {
      type: 'control-request',
      participantId,
      timestamp: Date.now(),
    };
    dc.send(JSON.stringify(message));
  }, [participantId]);

  const releaseControl = useCallback(() => {
    const dc = dataChannelRef.current;
    if (dc?.readyState !== 'open') return;

    setControlState('view-only');
    onControlStateChangeRef.current?.('view-only');

    const message: ControlMessage = {
      type: 'control-revoke',
      participantId,
      timestamp: Date.now(),
    };
    dc.send(JSON.stringify(message));
  }, [participantId]);

  const sendInput = useCallback(
    (event: InputEvent) => {
      const dc = dataChannelRef.current;
      if (dc?.readyState !== 'open' || controlState !== 'granted') return;

      const message: InputMessage = {
        type: 'input',
        timestamp: Date.now(),
        sequence: inputSequenceRef.current++,
        event,
      };
      dc.send(JSON.stringify(message));
    },
    [controlState]
  );

  // Collect stats for UI
  const collectStats = useCallback(
    async (generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      const pc = peerConnectionRef.current;
      if (!pc?.connectionState || pc.connectionState !== 'connected') return;

      try {
        const stats = (await pc.getStats()) as Map<string, Record<string, unknown>>;
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
        let bitrate = 0;
        let frameRate = 0;
        let packetLoss = 0;
        let roundTripTime = 0;
        let bytesReceived = 0;
        let packetsLost = 0;
        let packetsReceived = 0;

        stats.forEach((report: Record<string, unknown>) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            bytesReceived = (report.bytesReceived as number | undefined) ?? 0;
            frameRate = (report.framesPerSecond as number | undefined) ?? 0;
            packetsLost = (report.packetsLost as number | undefined) ?? 0;
            packetsReceived = (report.packetsReceived as number | undefined) ?? 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            roundTripTime = ((report.currentRoundTripTime as number | undefined) ?? 0) * 1000;
          }
        });

        if (packetsReceived > 0) {
          packetLoss = (packetsLost / (packetsReceived + packetsLost)) * 100;
        }

        bitrate = bytesReceived * 8;

        const metrics: QualityMetrics = { bitrate, frameRate, packetLoss, roundTripTime };
        setQualityMetrics(metrics);
        setNetworkQuality(calculateNetworkQuality(metrics));
      } catch {
        // Non-critical
      }
    },
    [calculateNetworkQuality, isCurrentGeneration]
  );

  // Report stats to API
  const reportStats = useCallback(
    async (generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      const pc = peerConnectionRef.current;
      if (pc?.connectionState !== 'connected') return;

      try {
        const stats = (await pc.getStats()) as Map<string, Record<string, unknown>>;
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
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
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            bytesReceived += (report.bytesReceived as number | undefined) ?? 0;
            packetsReceived += (report.packetsReceived as number | undefined) ?? 0;
            frameRate = report.framesPerSecond as number | undefined;
            frameWidth = report.frameWidth as number | undefined;
            frameHeight = report.frameHeight as number | undefined;
          }
          if (report.type === 'outbound-rtp') {
            bytesSent += (report.bytesSent as number | undefined) ?? 0;
            packetsSent += (report.packetsSent as number | undefined) ?? 0;
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
            participantId,
            role: 'viewer',
            timestamp: Date.now(),
            connectionState: pc.connectionState,
            bytesSent,
            bytesReceived,
            packetsSent,
            packetsReceived,
            packetsLost,
            roundTripTime,
            jitter: 0,
            frameRate,
            frameWidth,
            frameHeight,
            reportInterval: STATS_INTERVAL,
          }),
        });
      } catch (err) {
        console.error('[WebRTCViewer] Stats report error:', err);
      }
    },
    [isCurrentGeneration, sessionId, participantId]
  );

  // Process a single signaling message
  const processSignalMessage = useCallback(
    async (message: SignalMessage, generation: number) => {
      if (!isCurrentGeneration(generation)) return;
      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        switch (message.type) {
          case 'offer': {
            if (pc.signalingState !== 'stable') {
              console.warn(
                `[WebRTCViewer] Received offer in ${pc.signalingState} state — rolling back`
              );
              await pc.setLocalDescription({ type: 'rollback', sdp: '' });
            }

            if (!message.sdp) break;
            await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
            if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
            const answer = (await pc.createAnswer()) as OfferAnswer;
            // In-band FEC turns a lost packet into a duller syllable, not a gap.
            if (answer.sdp) answer.sdp = tuneOpusForVoice(answer.sdp);
            await pc.setLocalDescription(answer);
            if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;

            if (answer.sdp) {
              await sendSignal({
                type: 'answer',
                sdp: answer.sdp,
                senderId: participantId,
                targetId: message.senderId,
                ...(message.negotiationId ? { negotiationId: message.negotiationId } : {}),
                timestamp: Date.now(),
              });
            }

            // Drain buffered ICE candidates
            const pending = pendingCandidatesRef.current;
            if (pending.length > 0) {
              pendingCandidatesRef.current = [];
              for (const candidate of pending) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
              }
            }
            break;
          }

          case 'ice-candidate': {
            if (message.candidate?.candidate) {
              if (!pc.remoteDescription) {
                pendingCandidatesRef.current.push(message.candidate);
              } else {
                await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error('[WebRTCViewer] Error handling signal message:', err);
        if (isCurrentGeneration(generation)) {
          setError('Failed to process signaling message');
        }
      }
    },
    [isCurrentGeneration, participantId, sendSignal]
  );

  // Serialize signal processing
  const handleSignalMessage = useCallback(
    (message: SignalMessage, generation: number) => {
      signalQueueRef.current = signalQueueRef.current.then(() =>
        processSignalMessage(message, generation)
      );
    },
    [processSignalMessage]
  );

  // Handle connection failure with retry
  const handleConnectionFailure = useCallback(
    async (generation: number, pc: RTCPeerConnection) => {
      if (
        connectionFailureInFlightRef.current ||
        !isCurrentGeneration(generation) ||
        peerConnectionRef.current !== pc
      ) {
        return;
      }
      connectionFailureInFlightRef.current = true;

      try {
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          setConnectionState('reconnecting');
          setError(
            `Connection lost. Reconnecting (${String(reconnectAttemptsRef.current)}/${String(maxReconnectAttempts)})...`
          );

          try {
            const offer = (await pc.createOffer({ iceRestart: true })) as OfferAnswer;
            if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
            await pc.setLocalDescription(offer);
            if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;

            if (offer.sdp) {
              await sendSignal({
                type: 'offer',
                sdp: offer.sdp,
                senderId: participantId,
                timestamp: Date.now(),
              });
            }
          } catch {
            if (isCurrentGeneration(generation)) {
              setConnectionState('failed');
              setError('Failed to reconnect');
            }
          }
        } else {
          setConnectionState('failed');
          setError('Connection failed after multiple attempts');
        }
      } finally {
        connectionFailureInFlightRef.current = false;
      }
    },
    [isCurrentGeneration, participantId, sendSignal]
  );

  handleConnectionFailureRef.current = handleConnectionFailure;

  // Create peer connection
  const createPeerConnection = useCallback(
    (generation: number) => {
      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceCandidatePoolSize: 10,
      });

      pc.addEventListener('track', (event) => {
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
        const stream = event.streams[0] as MediaStream | undefined;
        if (!stream) return;

        const current = remoteStreamRef.current;
        const currentHasVideo = Boolean(current && current.getVideoTracks().length > 0);
        const incomingHasVideo = stream.getVideoTracks().length > 0;

        // Keep video stream selected if a later audio-only stream arrives.
        if (!current || (!currentHasVideo && incomingHasVideo)) {
          remoteStreamRef.current = stream;
          setRemoteStream(stream);
          onStreamReadyRef.current?.(stream);
        }
      });

      pc.addEventListener('icecandidate', (event) => {
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
        if (event.candidate) {
          void sendSignal({
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            senderId: participantId,
            timestamp: Date.now(),
          });
        }
      });

      pc.addEventListener('iceconnectionstatechange', () => {
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
        const state = pc.iceConnectionState;
        switch (state) {
          case 'checking':
            setConnectionState('connecting');
            break;
          case 'connected':
          case 'completed':
            setConnectionState('connected');
            setError(null);
            reconnectAttemptsRef.current = 0;
            // Re-apply mic priority now that negotiation is done. Some stacks
            // report no encodings on a sender until then, which would have made
            // the call made at addTrack() time a silent no-op.
            for (const sender of pc.getSenders()) {
              if (sender.track?.kind === 'audio') {
                void prioritizeAudioSender(sender);
              }
            }
            break;
          case 'disconnected':
            setConnectionState('reconnecting');
            break;
          case 'failed': {
            const handler = handleConnectionFailureRef.current;
            if (handler) void handler(generation, pc);
            break;
          }
          case 'closed':
            setConnectionState('disconnected');
            remoteStreamRef.current = null;
            setRemoteStream(null);
            onStreamEndedRef.current?.();
            break;
        }
      });

      pc.addEventListener('connectionstatechange', () => {
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
        const handler = handleConnectionFailureRef.current;
        if (pc.connectionState === 'failed' && handler) {
          void handler(generation, pc);
        }
      });

      pc.addEventListener('datachannel', (event) => {
        if (!isCurrentGeneration(generation) || peerConnectionRef.current !== pc) return;
        setupDataChannel(event.channel, generation);
      });

      return pc;
    },
    [isCurrentGeneration, participantId, sendSignal, setupDataChannel]
  );

  // Disconnect
  const disconnect = useCallback(() => {
    generationRef.current += 1;
    const hadRemoteStream = remoteStreamRef.current !== null;

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (statsReportIntervalRef.current) {
      clearInterval(statsReportIntervalRef.current);
      statsReportIntervalRef.current = null;
    }

    if (heartbeatWatchdogRef.current) {
      clearInterval(heartbeatWatchdogRef.current);
      heartbeatWatchdogRef.current = null;
    }

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      micStreamRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    isConnectingRef.current = false;
    connectionFailureInFlightRef.current = false;
    lastHeartbeatAtRef.current = 0;
    pendingCandidatesRef.current = [];
    signalQueueRef.current = Promise.resolve();
    remoteStreamRef.current = null;
    if (mountedRef.current) {
      setRemoteStream(null);
      setConnectionState('disconnected');
      setQualityMetrics(null);
      setDataChannelReady(false);
      setControlState('view-only');
      setMicEnabled(false);
      setHasMic(false);
      if (hadRemoteStream) {
        onStreamEndedRef.current?.();
      }
    }
  }, []);

  disconnectRef.current = disconnect;

  // Toggle mic
  const toggleMic = useCallback(() => {
    const micStream = micStreamRef.current;
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

  // Initialize connection
  const initialize = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }
    if (appStateRef.current !== 'active') {
      resumeOnActiveRef.current = true;
      return;
    }
    if (isConnectingRef.current || eventSourceRef.current) {
      return;
    }

    const generation = ++generationRef.current;
    isConnectingRef.current = true;

    console.log('[WebRTCViewer] Starting viewer for session:', sessionId);

    // Get auth token from secure storage
    try {
      const stored = await getStoredAuth();
      if (!isCurrentGeneration(generation)) return;
      if (!stored || isAuthExpired(stored)) {
        isConnectingRef.current = false;
        setError('Not authenticated. Please log in again.');
        return;
      }
      authTokenRef.current = stored.accessToken;
    } catch (err) {
      console.error('[WebRTCViewer] Failed to get auth token:', err);
      if (isCurrentGeneration(generation)) {
        isConnectingRef.current = false;
        setError('Failed to authenticate. Please log in again.');
      }
      return;
    }

    // Capture microphone
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
      micStreamRef.current = micStream;
      setHasMic(true);
      setMicEnabled(micEnabledIntentRef.current);
    } catch {
      if (!isCurrentGeneration(generation)) return;
      console.warn('[WebRTCViewer] Could not access microphone');
      micStreamRef.current = null;
      setHasMic(false);
      setMicEnabled(false);
    }

    // Build SSE URL
    const sseParams = new URLSearchParams({ participantId });
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
      console.log('[WebRTCViewer] SSE connected');
      lastHeartbeatAtRef.current = Date.now();
      isConnectingRef.current = false;
      setConnectionState('connecting');
      setError(null);

      try {
        const data = JSON.parse(event.data) as { iceServers?: RTCIceServer[] };
        if (data.iceServers && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers;
        }
      } catch {
        // Use default ICE servers
      }

      // A reconnect can emit another connected event on the same SSE object.
      // Retire the old peer before attaching a replacement.
      const previousPeer = peerConnectionRef.current;
      const previousStream = remoteStreamRef.current;
      peerConnectionRef.current = null;
      remoteStreamRef.current = null;
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      previousPeer?.close();

      setRemoteStream(null);
      setQualityMetrics(null);
      setDataChannelReady(false);
      setControlState('view-only');
      if (previousStream) {
        onStreamEndedRef.current?.();
      }

      pendingCandidatesRef.current = [];
      signalQueueRef.current = Promise.resolve();
      const pc = createPeerConnection(generation);
      peerConnectionRef.current = pc;

      // Add mic tracks
      const micStream = micStreamRef.current;
      if (micStream) {
        micStream.getAudioTracks().forEach((track) => {
          void prioritizeAudioSender(pc.addTrack(track, micStream));
        });
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
        handleSignalMessage(signal, generation);
      } catch (err) {
        console.error('[WebRTCViewer] Failed to parse signal:', err);
      }
    });

    eventSource.addEventListener('presence-join', (event) => {
      if (!isCurrentEventSource()) return;
      try {
        const { presences } = JSON.parse(event.data) as {
          presences: { user_id: string; role: string }[];
        };
        for (const presence of presences) {
          if (presence.role === 'host') {
            console.log('[WebRTCViewer] Host is present:', presence.user_id);
          }
        }
      } catch (err) {
        console.error('[WebRTCViewer] Failed to parse presence:', err);
      }
    });

    eventSource.addEventListener('presence-leave', (event) => {
      if (!isCurrentEventSource()) return;
      try {
        const { presences } = JSON.parse(event.data) as {
          presences: { user_id: string; role: string }[];
        };
        for (const presence of presences) {
          if (presence.role === 'host') {
            setError('Host has disconnected');
          }
        }
      } catch (err) {
        console.error('[WebRTCViewer] Failed to parse presence leave:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      if (!isCurrentEventSource()) return;
      console.error('[WebRTCViewer] SSE error');
      isConnectingRef.current = false;
      setError('Connection to server lost. Reconnecting...');
    });

    statsIntervalRef.current = setInterval(
      () => void collectStats(generation),
      STATS_DISPLAY_INTERVAL
    );
    statsReportIntervalRef.current = setInterval(
      () => void reportStats(generation),
      STATS_INTERVAL
    );
    heartbeatWatchdogRef.current = setInterval(() => {
      if (!isCurrentEventSource()) return;
      if (Date.now() - lastHeartbeatAtRef.current <= HEARTBEAT_TIMEOUT) return;

      setError('Connection heartbeat timed out. Reconnecting...');
      disconnectRef.current?.();
      void initializeRef.current?.();
    }, HEARTBEAT_WATCHDOG_INTERVAL);
  }, [
    sessionId,
    participantId,
    isCurrentGeneration,
    handleSignalMessage,
    createPeerConnection,
    collectStats,
    reportStats,
  ]);

  initializeRef.current = initialize;

  // Manual reconnect
  const reconnect = useCallback(() => {
    resumeOnActiveRef.current = false;
    reconnectAttemptsRef.current = 0;
    disconnect();
    void initializeRef.current?.();
  }, [disconnect]);

  // Suspend native media and transport while backgrounded, then restore one
  // fresh connection when the app becomes active again.
  useEffect(() => {
    mountedRef.current = true;
    appStateRef.current = AppState.currentState;

    if (appStateRef.current === 'active') {
      void initialize();
    } else {
      resumeOnActiveRef.current = true;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background') {
        if (previousState !== 'background') {
          const hadActiveConnection =
            isConnectingRef.current ||
            eventSourceRef.current !== null ||
            peerConnectionRef.current !== null;
          resumeOnActiveRef.current = resumeOnActiveRef.current || hadActiveConnection;
          if (hadActiveConnection) {
            disconnect();
          }
        }
        return;
      }

      if (nextState === 'active' && previousState !== 'active' && resumeOnActiveRef.current) {
        resumeOnActiveRef.current = false;
        reconnectAttemptsRef.current = 0;
        void initializeRef.current?.();
      }
    });

    return () => {
      subscription.remove();
      mountedRef.current = false;
      resumeOnActiveRef.current = false;
      disconnect();
    };
  }, [initialize, disconnect]);

  return {
    connectionState,
    remoteStream,
    qualityMetrics,
    networkQuality,
    error,
    reconnect,
    disconnect,
    controlState,
    dataChannelReady,
    requestControl,
    releaseControl,
    sendInput,
    micEnabled,
    hasMic,
    toggleMic,
  };
}
