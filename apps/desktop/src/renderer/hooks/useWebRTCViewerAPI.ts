/**
 * WebRTC Viewer Hook using API-based signaling
 *
 * This hook manages WebRTC connections for viewing a screen share session.
 * It uses HTTP/SSE endpoints for signaling instead of direct Supabase connection,
 * matching the desktop host hook architecture.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import type {
  ConnectionState,
  QualityMetrics,
  NetworkQuality,
  InputMessage,
  InputEvent,
  ControlMessage,
  ControlStateUI,
  CursorPositionMessage,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';

// Stats collection interval
const STATS_INTERVAL = 30000; // 30 seconds
const STATS_DISPLAY_INTERVAL = 2000; // 2 seconds for UI metrics

// Default ICE servers (STUN only — overridden with TURN from the SSE connected event)
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
  timestamp: number;
}

interface UseWebRTCViewerAPIOptions {
  sessionId: string;
  participantId: string;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnded?: () => void;
  onControlStateChange?: (state: ControlStateUI) => void;
  onCursorUpdate?: (cursor: CursorPositionMessage) => void;
  onKicked?: (reason?: string) => void;
}

interface UseWebRTCViewerAPIReturn {
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
  sendCursorPosition: (x: number, y: number, visible: boolean) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

export function useWebRTCViewerAPI({
  sessionId,
  participantId,
  onStreamReady,
  onStreamEnded,
  onControlStateChange,
  onCursorUpdate,
  onKicked,
}: UseWebRTCViewerAPIOptions): UseWebRTCViewerAPIReturn {
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsReportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const inputSequenceRef = useRef(0);
  const isConnectingRef = useRef(false);
  const maxReconnectAttempts = 3;
  // Track previous bytesReceived for delta-based bitrate calculation
  const prevBytesReceivedRef = useRef(0);
  const prevStatsTimestampRef = useRef(0);

  // ICE servers received from the SSE connected event (includes TURN)
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  // Buffer ICE candidates that arrive before remote description is set
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  // Serialize signaling message processing to prevent race conditions
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Callback refs to avoid circular dependencies
  const handleConnectionFailureRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const onControlStateChangeRef = useRef(onControlStateChange);
  const onCursorUpdateRef = useRef(onCursorUpdate);
  const onKickedRef = useRef(onKicked);
  const disconnectRef = useRef<(() => void) | undefined>(undefined);

  onControlStateChangeRef.current = onControlStateChange;
  onCursorUpdateRef.current = onCursorUpdate;
  onKickedRef.current = onKicked;

  // Calculate network quality from metrics
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

  // Handle incoming data channel messages
  const handleDataChannelMessage = useCallback((event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as
        | ControlMessage
        | CursorPositionMessage
        | KickMessage
        | MuteMessage;

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
          case 'cursor':
            onCursorUpdateRef.current?.(message);
            break;
          case 'kick':
            setError('You were removed from the session');
            disconnectRef.current?.();
            onKickedRef.current?.(message.reason);
            break;
          case 'mute': {
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
      // Invalid message format
    }
  }, []);

  // Setup data channel
  const setupDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;

      channel.onopen = () => {
        setDataChannelReady(true);
      };

      channel.onclose = () => {
        setDataChannelReady(false);
        setControlState('view-only');
      };

      channel.onerror = (err) => {
        console.error('[WebRTCViewer] Data channel error:', err);
        setDataChannelReady(false);
      };

      channel.onmessage = handleDataChannelMessage;
    },
    [handleDataChannelMessage]
  );

  // Request control from host
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

  // Release control
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

  // Send input event
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

  // Send cursor position
  const sendCursorPosition = useCallback(
    (x: number, y: number, visible: boolean) => {
      const dc = dataChannelRef.current;
      if (dc?.readyState !== 'open') return;

      const message: CursorPositionMessage = {
        type: 'cursor',
        participantId,
        x,
        y,
        visible,
      };
      dc.send(JSON.stringify(message));
    },
    [participantId]
  );

  // Collect WebRTC stats for UI display
  const collectStats = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc?.connectionState || pc.connectionState !== 'connected') return;

    try {
      const stats = await pc.getStats();
      let bitrate = 0;
      let frameRate = 0;
      let packetLoss = 0;
      let roundTripTime = 0;
      let bytesReceived = 0;
      let packetsLost = 0;
      let packetsReceived = 0;

      stats.forEach((report: RTCStatsReport[keyof RTCStatsReport] & Record<string, unknown>) => {
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

      // Calculate bitrate as delta (bits per second) instead of cumulative total
      const now = Date.now();
      const elapsed = (now - prevStatsTimestampRef.current) / 1000;
      if (prevStatsTimestampRef.current > 0 && elapsed > 0) {
        const deltaBytes = bytesReceived - prevBytesReceivedRef.current;
        bitrate = (deltaBytes * 8) / elapsed;
      }
      prevBytesReceivedRef.current = bytesReceived;
      prevStatsTimestampRef.current = now;

      const metrics: QualityMetrics = { bitrate, frameRate, packetLoss, roundTripTime };
      setQualityMetrics(metrics);
      setNetworkQuality(calculateNetworkQuality(metrics));
    } catch {
      // Non-critical
    }
  }, [calculateNetworkQuality]);

  // Report usage stats to API
  const reportStats = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (pc?.connectionState !== 'connected') return;

    try {
      const stats = await pc.getStats();
      let bytesSent = 0;
      let bytesReceived = 0;
      let packetsSent = 0;
      let packetsReceived = 0;
      let packetsLost = 0;
      let roundTripTime: number | undefined;
      let frameRate: number | undefined;
      let frameWidth: number | undefined;
      let frameHeight: number | undefined;

      stats.forEach((report: RTCStatsReport[keyof RTCStatsReport] & Record<string, unknown>) => {
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
  }, [sessionId, participantId]);

  // Process a single signaling message (called sequentially via signalQueueRef)
  const processSignalMessage = useCallback(
    async (message: SignalMessage) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      const addIceCandidateSafely = async (candidateInit: RTCIceCandidateInit) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isStaleMidCandidate =
            msg.includes('no media section with that mid found') ||
            msg.includes('Invalid candidate. Mid');

          if (isStaleMidCandidate) {
            console.warn('[WebRTCViewer] Ignoring stale ICE candidate for superseded m-line', {
              sdpMid: candidateInit.sdpMid ?? null,
              sdpMLineIndex: candidateInit.sdpMLineIndex ?? null,
            });
            return;
          }

          throw err;
        }
      };

      try {
        switch (message.type) {
          case 'offer': {
            // If we're not in 'stable' state (e.g. already processing an offer),
            // rollback first so we can accept the new offer.
            if (pc.signalingState !== 'stable') {
              console.warn(
                `[WebRTCViewer] Received offer in ${pc.signalingState} state — rolling back`
              );
              await pc.setLocalDescription({ type: 'rollback' });
            }

            // Drop buffered candidates from prior offers; mids can change across renegotiation.
            if (pendingCandidatesRef.current.length > 0) {
              console.log(
                `[WebRTCViewer] Clearing ${String(pendingCandidatesRef.current.length)} buffered ICE candidates before applying new offer`
              );
              pendingCandidatesRef.current = [];
            }

            await pc.setRemoteDescription({
              type: 'offer',
              sdp: message.sdp,
            });

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (answer.sdp) {
              await sendSignal({
                type: 'answer',
                sdp: answer.sdp,
                senderId: participantId,
                targetId: message.senderId,
                timestamp: Date.now(),
              });
            }

            // Drain any ICE candidates that arrived before remote description was set
            const pending = pendingCandidatesRef.current;
            if (pending.length > 0) {
              console.log(
                `[WebRTCViewer] Draining ${String(pending.length)} buffered ICE candidates`
              );
              pendingCandidatesRef.current = [];
              for (const candidate of pending) {
                await addIceCandidateSafely(candidate);
              }
            }
            break;
          }

          case 'ice-candidate': {
            if (message.candidate?.candidate) {
              // Buffer if remote description not yet set
              if (!pc.remoteDescription) {
                pendingCandidatesRef.current.push(message.candidate);
              } else {
                await addIceCandidateSafely(message.candidate);
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error('[WebRTCViewer] Error handling signal message:', err);
        setError('Failed to process signaling message');
      }
    },
    [participantId, sendSignal]
  );

  // Handle signaling messages from SSE — serialized via promise chain
  const handleSignalMessage = useCallback(
    (message: SignalMessage) => {
      signalQueueRef.current = signalQueueRef.current.then(() => processSignalMessage(message));
    },
    [processSignalMessage]
  );

  // Handle connection failure with retry
  const handleConnectionFailure = useCallback(async () => {
    if (reconnectAttemptsRef.current < maxReconnectAttempts) {
      reconnectAttemptsRef.current++;
      setConnectionState('reconnecting');
      setError(
        `Connection lost. Reconnecting (${String(reconnectAttemptsRef.current)}/${String(maxReconnectAttempts)})...`
      );

      // Attempt ICE restart
      const pc = peerConnectionRef.current;
      if (pc) {
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);

          if (offer.sdp) {
            await sendSignal({
              type: 'offer',
              sdp: offer.sdp,
              senderId: participantId,
              timestamp: Date.now(),
            });
          }
        } catch {
          setConnectionState('failed');
          setError('Failed to reconnect');
        }
      }
    } else {
      setConnectionState('failed');
      setError('Connection failed after multiple attempts');
    }
  }, [participantId, sendSignal]);

  handleConnectionFailureRef.current = handleConnectionFailure;

  // Create and configure peer connection
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 10,
    });

    // Handle incoming tracks (video + audio from host)
    pc.ontrack = (event) => {
      const incomingStream = event.streams[0] as MediaStream | undefined;
      console.log('[WebRTCViewer] ontrack', {
        kind: event.track.kind,
        id: event.track.id,
        muted: event.track.muted,
        readyState: event.track.readyState,
        streamCount: event.streams.length,
        streamId: incomingStream?.id,
        streamVideoTracks: incomingStream?.getVideoTracks().length ?? 0,
        streamAudioTracks: incomingStream?.getAudioTracks().length ?? 0,
        mid: event.transceiver.mid,
      });

      // Electron/Chromium may deliver tracks in separate or streamless ontrack events.
      // Merge tracks into a single composite stream for the desktop viewer.
      const current = remoteStreamRef.current;
      const composite = current ?? new MediaStream();

      const addTrackIfMissing = (track: MediaStreamTrack) => {
        const exists = composite.getTracks().some((existing) => existing.id === track.id);
        if (!exists) {
          // Replace stale track of same kind if present (e.g., renegotiation/re-publish).
          const sameKind = composite.getTracks().find((existing) => existing.kind === track.kind);
          if (sameKind) {
            composite.removeTrack(sameKind);
          }
          composite.addTrack(track);
        }
      };

      if (incomingStream) {
        incomingStream.getTracks().forEach(addTrackIfMissing);
      } else {
        addTrackIfMissing(event.track);
      }

      event.track.onended = () => {
        console.warn('[WebRTCViewer] Remote track ended', {
          kind: event.track.kind,
          id: event.track.id,
        });
      };
      event.track.onmute = () => {
        console.warn('[WebRTCViewer] Remote track muted', {
          kind: event.track.kind,
          id: event.track.id,
        });
      };
      event.track.onunmute = () => {
        console.log('[WebRTCViewer] Remote track unmuted', {
          kind: event.track.kind,
          id: event.track.id,
        });
      };

      // Re-emit a fresh stream object so React/video attachment updates when tracks arrive later.
      const mergedStream = new MediaStream(composite.getTracks());
      remoteStreamRef.current = mergedStream;
      setRemoteStream(mergedStream);
      console.log('[WebRTCViewer] Selected remote stream', {
        streamId: mergedStream.id,
        videoTracks: mergedStream.getVideoTracks().map((track) => ({
          id: track.id,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings(),
        })),
        audioTracks: mergedStream.getAudioTracks().map((track) => ({
          id: track.id,
          muted: track.muted,
          readyState: track.readyState,
        })),
      });
      onStreamReady?.(mergedStream);
    };

    // Handle ICE candidates — send via API
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
          senderId: participantId,
          timestamp: Date.now(),
        });
      }
    };

    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
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
          break;
        case 'disconnected':
          setConnectionState('reconnecting');
          break;
        case 'failed': {
          const handler = handleConnectionFailureRef.current;
          if (handler) void handler();
          break;
        }
        case 'closed':
          setConnectionState('disconnected');
          remoteStreamRef.current = null;
          setRemoteStream(null);
          onStreamEnded?.();
          break;
      }
    };

    pc.onconnectionstatechange = () => {
      const handler = handleConnectionFailureRef.current;
      if (pc.connectionState === 'failed' && handler) {
        void handler();
      }
    };

    // Handle incoming data channel from host
    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    return pc;
  }, [participantId, onStreamReady, onStreamEnded, sendSignal, setupDataChannel]);

  // Disconnect and clean up
  const disconnect = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (statsReportIntervalRef.current) {
      clearInterval(statsReportIntervalRef.current);
      statsReportIntervalRef.current = null;
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
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setConnectionState('disconnected');
    setQualityMetrics(null);
    setDataChannelReady(false);
    setControlState('view-only');
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  disconnectRef.current = disconnect;

  // Toggle microphone
  const toggleMic = useCallback(() => {
    const micStream = micStreamRef.current;
    if (!micStream) return;

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) return;

    const newEnabled = !micEnabled;
    tracks.forEach((track) => {
      track.enabled = newEnabled;
    });
    setMicEnabled(newEnabled);
  }, [micEnabled]);

  // Initialize connection
  const initialize = useCallback(async () => {
    if (isConnectingRef.current || eventSourceRef.current) return;
    isConnectingRef.current = true;

    console.log('[WebRTCViewer] Starting viewer for session:', sessionId);

    // Get auth token
    try {
      const api = getElectronAPI();
      const { token } = await api.invoke('auth:getToken', undefined);
      authTokenRef.current = token;
    } catch (err) {
      console.error('[WebRTCViewer] Failed to get auth token:', err);
      isConnectingRef.current = false;
      setError('Failed to authenticate. Please log in again.');
      return;
    }

    // Capture microphone before peer connection
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = micStream;
      setHasMic(true);
      setMicEnabled(true);
      console.log('[WebRTCViewer] Microphone captured');
    } catch (err: unknown) {
      console.warn('[WebRTCViewer] Could not access microphone:', err);
      micStreamRef.current = null;
      setHasMic(false);
      setMicEnabled(false);
    }

    // Build SSE URL with token
    const sseParams = new URLSearchParams({
      participantId,
    });
    if (authTokenRef.current) {
      sseParams.set('token', authTokenRef.current);
    }

    // Connect to SSE stream for signals
    const eventSource = new EventSource(
      `${API_BASE_URL}/api/sessions/${sessionId}/signal/stream?${sseParams.toString()}`
    );

    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', (event) => {
      console.log('[WebRTCViewer] SSE connected:', event.data);
      isConnectingRef.current = false;
      setConnectionState('connecting');
      setError(null);

      // Use ICE servers from the server (includes TURN) if provided
      try {
        const data = JSON.parse(event.data as string) as {
          iceServers?: RTCIceServer[];
        };
        if (data.iceServers && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers;
          console.log('[WebRTCViewer] Received ICE servers from server:', data.iceServers.length);
        }
      } catch {
        // Use default ICE servers
      }

      // Close existing peer connection before creating a new one (prevents leak on SSE reconnect)
      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch {
          // Ignore
        }
        peerConnectionRef.current = null;
      }

      // Create peer connection AFTER receiving ICE servers (includes TURN)
      pendingCandidatesRef.current = [];
      signalQueueRef.current = Promise.resolve();
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Add mic tracks to peer connection for SDP negotiation
      const micStream = micStreamRef.current;
      if (micStream) {
        micStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, micStream);
        });
      }
    });

    eventSource.addEventListener('signal', (event) => {
      try {
        const signal = JSON.parse(event.data as string) as SignalMessage;
        handleSignalMessage(signal);
      } catch (err) {
        console.error('[WebRTCViewer] Failed to parse signal:', err);
      }
    });

    eventSource.addEventListener('presence-join', (event) => {
      try {
        const { presences } = JSON.parse(event.data as string) as {
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
      try {
        const { presences } = JSON.parse(event.data as string) as {
          presences: { user_id: string; role: string }[];
        };
        for (const presence of presences) {
          if (presence.role === 'host') {
            console.log('[WebRTCViewer] Host left');
            setError('Host has disconnected');
          }
        }
      } catch (err) {
        console.error('[WebRTCViewer] Failed to parse presence leave:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      console.error('[WebRTCViewer] SSE error');
      isConnectingRef.current = false;
      setError('Connection to server lost. Reconnecting...');
    });

    // Start stats collection for UI display
    statsIntervalRef.current = setInterval(() => void collectStats(), STATS_DISPLAY_INTERVAL);

    // Start stats reporting to API
    statsReportIntervalRef.current = setInterval(() => void reportStats(), STATS_INTERVAL);
  }, [
    sessionId,
    participantId,
    handleSignalMessage,
    createPeerConnection,
    collectStats,
    reportStats,
  ]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    disconnect();
    void initialize();
  }, [disconnect, initialize]);

  // Initialize on mount
  useEffect(() => {
    void initialize();
    return () => {
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
    sendCursorPosition,
    micEnabled,
    hasMic,
    toggleMic,
  };
}
