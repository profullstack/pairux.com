/**
 * WebRTC Host Hook using API-based signaling
 *
 * This hook manages WebRTC connections for hosting a screen share session.
 * It uses HTTP/SSE endpoints for signaling instead of direct Supabase connection,
 * enabling server-side usage tracking for billing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import type {
  ConnectionState,
  NetworkQuality,
  InputMessage,
  CursorPositionMessage,
  ControlMessage,
  KickMessage,
} from '@pairux/shared-types';

// Adaptive bitrate encoding presets
interface BitratePreset {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

const BITRATE_PRESETS: Record<NetworkQuality, BitratePreset> = {
  excellent: { maxBitrate: 8_000_000, scaleResolutionDownBy: 1, maxFramerate: 60 },
  good: { maxBitrate: 4_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  poor: { maxBitrate: 1_500_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  bad: { maxBitrate: 600_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
};

// Stats collection and reporting interval
const STATS_INTERVAL = 30000; // 30 seconds

// ICE server configuration
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface ViewerConnection {
  id: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connectionState: ConnectionState;
  controlState: 'view-only' | 'requested' | 'granted';
  networkQuality: NetworkQuality;
  currentPreset: NetworkQuality;
}

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  senderId: string;
  targetId?: string;
  timestamp: number;
}

interface UseWebRTCHostAPIOptions {
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

interface UseWebRTCHostAPIReturn {
  isHosting: boolean;
  viewerCount: number;
  viewers: Map<string, ViewerConnection>;
  controllingViewer: string | null;
  error: string | null;
  startHosting: () => Promise<void>;
  stopHosting: () => void;
  grantControl: (viewerId: string) => void;
  revokeControl: (viewerId: string) => void;
  kickViewer: (viewerId: string) => void;
}

export function useWebRTCHostAPI({
  sessionId,
  hostId,
  localStream,
  allowControl = false,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
  onCursorUpdate,
}: UseWebRTCHostAPIOptions): UseWebRTCHostAPIReturn {
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [controllingViewer, setControllingViewer] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const removeViewerRef = useRef<((viewerId: string) => void) | undefined>(undefined);
  const authTokenRef = useRef<string | null>(null);

  // Keep callback refs updated
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
        const stats = await viewer.peerConnection.getStats();
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

        // Report to API
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

  // Calculate network quality from stats (for future adaptive bitrate)
  const _calculateNetworkQuality = useCallback(
    (packetLoss: number, roundTripTime: number): NetworkQuality => {
      if (packetLoss < 1 && roundTripTime < 50) return 'excellent';
      if (packetLoss < 3 && roundTripTime < 100) return 'good';
      if (packetLoss < 8 && roundTripTime < 200) return 'poor';
      return 'bad';
    },
    []
  );

  // Adjust bitrate for a viewer (for future adaptive bitrate)
  const _adjustBitrate = useCallback(async (viewer: ViewerConnection, quality: NetworkQuality) => {
    if (viewer.currentPreset === quality) return;

    const preset = BITRATE_PRESETS[quality];
    const senders = viewer.peerConnection.getSenders();
    const videoSender = senders.find((s) => s.track?.kind === 'video');

    if (!videoSender) return;

    try {
      const params = videoSender.getParameters();
      const encoding = params.encodings[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (encoding !== undefined) {
        encoding.maxBitrate = preset.maxBitrate;
        encoding.scaleResolutionDownBy = preset.scaleResolutionDownBy;
        encoding.maxFramerate = preset.maxFramerate;
        await videoSender.setParameters(params);
        viewer.currentPreset = quality;
      }
    } catch (err) {
      console.error('[WebRTCHost] Failed to adjust bitrate:', err);
    }
  }, []);

  // Handle data channel messages
  const handleDataChannelMessage = useCallback((viewerId: string, event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as
        | ControlMessage
        | InputMessage
        | CursorPositionMessage;

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

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    (viewerId: string): RTCPeerConnection => {
      console.log('[WebRTCHost] Creating peer connection for viewer:', viewerId);

      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
      });

      // Add local stream tracks
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          if (track.kind === 'video') {
            track.contentHint = 'detail';
          }
          const sender = pc.addTrack(track, localStream);

          if (track.kind === 'video') {
            const params = sender.getParameters();
            const preset = BITRATE_PRESETS.excellent;
            const encoding = params.encodings[0];
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (encoding !== undefined) {
              encoding.maxBitrate = preset.maxBitrate;
              encoding.maxFramerate = preset.maxFramerate;
              encoding.priority = 'high';
              encoding.networkPriority = 'high';
            }
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            void sender.setParameters(params).catch(() => {});
          }
        });
      }

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal({
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            senderId: hostId,
            targetId: viewerId,
            timestamp: Date.now(),
          });
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
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

          console.log(`[WebRTCHost] Viewer ${viewerId} connection state:`, newState);
          viewer.connectionState = newState;
          setViewers(new Map(viewersRef.current));

          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            removeViewerRef.current?.(viewerId);
          }
        }
      };

      // Create data channel for control
      if (allowControl) {
        const dc = pc.createDataChannel('control', { ordered: true });

        dc.onopen = () => {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            viewer.dataChannel = dc;
            setViewers(new Map(viewersRef.current));
          }
        };

        dc.onclose = () => {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            viewer.dataChannel = null;
            viewer.controlState = 'view-only';
            setViewers(new Map(viewersRef.current));
            setControllingViewer((prev) => (prev === viewerId ? null : prev));
          }
        };

        dc.onmessage = (event: MessageEvent<string>) => {
          handleDataChannelMessage(viewerId, event);
        };
      }

      return pc;
    },
    [localStream, hostId, allowControl, handleDataChannelMessage, sendSignal]
  );

  // Remove a viewer
  const removeViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer) {
        console.log('[WebRTCHost] Removing viewer:', viewerId);
        viewer.peerConnection.close();
        viewersRef.current.delete(viewerId);
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
      };

      viewersRef.current.set(viewerId, viewer);
      setViewers(new Map(viewersRef.current));
      onViewerJoined?.(viewerId);

      // Create and send offer
      try {
        const offer = await pc.createOffer();
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
            console.log('[WebRTCHost] Received answer from:', viewerId);
            await viewer.peerConnection.setRemoteDescription({
              type: 'answer',
              sdp: signal.sdp,
            });
          }
          break;
        }

        case 'ice-candidate': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && signal.candidate?.candidate) {
            await viewer.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
          break;
        }
      }
    },
    [hostId]
  );

  // Start hosting
  const startHosting = useCallback(async () => {
    if (!localStream) {
      setError('No stream available. Please start screen sharing first.');
      return;
    }

    console.log('[WebRTCHost] Starting hosting for session:', sessionId);

    // Get auth token for API authentication
    try {
      const api = getElectronAPI();
      const { token } = await api.invoke('auth:getToken', undefined);
      authTokenRef.current = token;
      console.log('[WebRTCHost] Auth token retrieved:', token ? 'yes' : 'no');
    } catch (err) {
      console.error('[WebRTCHost] Failed to get auth token:', err);
      setError('Failed to authenticate. Please log in again.');
      return;
    }

    // Build SSE URL with token (EventSource doesn't support custom headers)
    const sseParams = new URLSearchParams({
      participantId: hostId,
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
      console.log('[WebRTCHost] SSE connected:', event.data);
      setIsHosting(true);
      setError(null);
    });

    eventSource.addEventListener('signal', (event) => {
      try {
        const signal = JSON.parse(event.data as string) as SignalMessage;
        void handleSignalMessage(signal);
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse signal:', err);
      }
    });

    eventSource.addEventListener('presence-join', (event) => {
      try {
        const { presences } = JSON.parse(event.data as string) as {
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
        const { presences } = JSON.parse(event.data as string) as {
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
      setError('Connection to server lost. Reconnecting...');
    });

    // Start stats reporting
    statsIntervalRef.current = setInterval(() => {
      void reportStats();
    }, STATS_INTERVAL);
  }, [
    sessionId,
    hostId,
    localStream,
    handleSignalMessage,
    handleViewerJoin,
    removeViewer,
    reportStats,
  ]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    console.log('[WebRTCHost] Stopping hosting');

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
  }, []);

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

  return {
    isHosting,
    viewerCount: viewers.size,
    viewers,
    controllingViewer,
    error,
    startHosting,
    stopHosting,
    grantControl,
    revokeControl,
    kickViewer,
  };
}
