import { useState, useEffect, useRef, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type {
  ConnectionState,
  QualityMetrics,
  NetworkQuality,
  SignalMessage,
} from '@pairux/shared-types';

// ICE server configuration
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Get TURN servers from environment if available
if (
  process.env.NEXT_PUBLIC_TURN_URL &&
  process.env.NEXT_PUBLIC_TURN_USERNAME &&
  process.env.NEXT_PUBLIC_TURN_CREDENTIAL
) {
  ICE_SERVERS.push({
    urls: process.env.NEXT_PUBLIC_TURN_URL,
    username: process.env.NEXT_PUBLIC_TURN_USERNAME,
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
  });
}

interface UseWebRTCOptions {
  sessionId: string;
  participantId: string;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnded?: () => void;
}

interface UseWebRTCReturn {
  connectionState: ConnectionState;
  remoteStream: MediaStream | null;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

export function useWebRTC({
  sessionId,
  participantId,
  onStreamReady,
  onStreamEnded,
}: UseWebRTCOptions): UseWebRTCReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | null>(null);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 3;

  // Use refs to avoid circular dependencies in callbacks
  const handleConnectionFailureRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Calculate network quality from metrics
  const calculateNetworkQuality = useCallback((metrics: QualityMetrics): NetworkQuality => {
    const { packetLoss, roundTripTime } = metrics;

    if (packetLoss < 1 && roundTripTime < 50) {
      return 'excellent';
    } else if (packetLoss < 3 && roundTripTime < 100) {
      return 'good';
    } else if (packetLoss < 8 && roundTripTime < 200) {
      return 'poor';
    }
    return 'bad';
  }, []);

  // Collect WebRTC stats
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

      // Calculate packet loss percentage
      if (packetsReceived > 0) {
        packetLoss = (packetsLost / (packetsReceived + packetsLost)) * 100;
      }

      // Estimate bitrate (simplified - would need delta calculation in production)
      bitrate = bytesReceived * 8; // bits

      const metrics: QualityMetrics = {
        bitrate,
        frameRate,
        packetLoss,
        roundTripTime,
      };

      setQualityMetrics(metrics);
      setNetworkQuality(calculateNetworkQuality(metrics));
    } catch {
      // Stats collection failed - non-critical
    }
  }, [calculateNetworkQuality]);

  // Handle signaling messages
  const handleSignalMessage = useCallback(
    async (message: SignalMessage) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        switch (message.type) {
          case 'offer': {
            await pc.setRemoteDescription({
              type: 'offer',
              sdp: message.sdp,
            });

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            // Send answer back via signaling channel
            if (answer.sdp) {
              void channelRef.current?.send({
                type: 'broadcast',
                event: 'signal',
                payload: {
                  type: 'answer',
                  sdp: answer.sdp,
                  senderId: participantId,
                  timestamp: Date.now(),
                } satisfies SignalMessage,
              });
            }
            break;
          }

          case 'ice-candidate': {
            if (message.candidate.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
            }
            break;
          }
        }
      } catch (err) {
        console.error('Error handling signal message:', err);
        setError('Failed to process signaling message');
      }
    },
    [participantId]
  );

  // Handle connection failure with retry logic
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
            void channelRef.current?.send({
              type: 'broadcast',
              event: 'signal',
              payload: {
                type: 'offer',
                sdp: offer.sdp,
                senderId: participantId,
                timestamp: Date.now(),
              } satisfies SignalMessage,
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
  }, [participantId]);

  // Keep ref updated
  handleConnectionFailureRef.current = handleConnectionFailure;

  // Create and configure peer connection
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
    });

    // Handle incoming tracks (video stream from host)
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (event.track.kind === 'video' && stream) {
        setRemoteStream(stream);
        onStreamReady?.(stream);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void channelRef.current?.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            senderId: participantId,
            timestamp: Date.now(),
          } satisfies SignalMessage,
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
          if (handler) {
            void handler();
          }
          break;
        }
        case 'closed':
          setConnectionState('disconnected');
          setRemoteStream(null);
          onStreamEnded?.();
          break;
      }
    };

    // Handle connection state (overall)
    pc.onconnectionstatechange = () => {
      const handler = handleConnectionFailureRef.current;
      if (pc.connectionState === 'failed' && handler) {
        void handler();
      }
    };

    return pc;
  }, [participantId, onStreamReady, onStreamEnded]);

  // Disconnect
  const disconnect = useCallback(() => {
    // Stop stats collection
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Unsubscribe from channel
    if (channelRef.current) {
      void channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    setRemoteStream(null);
    setConnectionState('disconnected');
    setQualityMetrics(null);
  }, []);

  // Initialize connection
  const initialize = useCallback(() => {
    const supabase = createClient();

    // Create signaling channel
    const channel = supabase.channel(`session:${sessionId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: participantId },
      },
    });

    channelRef.current = channel;

    // Subscribe to signaling events
    channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const message = payload as SignalMessage;
        // Only process messages not from self
        if (message.senderId !== participantId) {
          void handleSignalMessage(message);
        }
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('connecting');

          // Create peer connection
          const pc = createPeerConnection();
          peerConnectionRef.current = pc;

          // Track presence
          void channel.track({
            user_id: participantId,
            online_at: new Date().toISOString(),
            role: 'viewer',
          });
        }
      });

    // Start stats collection
    statsIntervalRef.current = setInterval(() => void collectStats(), 2000);
  }, [sessionId, participantId, handleSignalMessage, createPeerConnection, collectStats]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    disconnect();
    initialize();
  }, [disconnect, initialize]);

  // Initialize on mount
  useEffect(() => {
    initialize();

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
  };
}
