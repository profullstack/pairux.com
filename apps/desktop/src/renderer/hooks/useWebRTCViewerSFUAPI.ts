/**
 * WebRTC Viewer Hook using LiveKit SFU with API-based token fetching
 *
 * Desktop variant of useWebRTCSFU. Uses HTTP Bearer token auth
 * to fetch LiveKit tokens from the PairUX API.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState as LKConnectionState,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
import { API_BASE_URL } from '../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import { announceTailnet, buildTailnetHello } from '@/lib/tailnetHello';
import { buildSfuRtcConfig } from '@/lib/iceConfig';
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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface UseWebRTCViewerSFUAPIOptions {
  sessionId: string;
  participantId: string;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnded?: () => void;
  onControlStateChange?: (state: ControlStateUI) => void;
  onKicked?: (reason?: string) => void;
  onPresenceChange?: () => void;
}

interface UseWebRTCViewerSFUAPIReturn {
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

function mapConnectionState(lkState: LKConnectionState): ConnectionState {
  switch (lkState) {
    case LKConnectionState.Disconnected:
      return 'disconnected';
    case LKConnectionState.Connecting:
      return 'connecting';
    case LKConnectionState.Connected:
      return 'connected';
    case LKConnectionState.Reconnecting:
      return 'reconnecting';
    default:
      return 'idle';
  }
}

export function useWebRTCViewerSFUAPI({
  sessionId,
  participantId,
  onStreamReady,
  onStreamEnded,
  onControlStateChange,
  onKicked,
  onPresenceChange,
}: UseWebRTCViewerSFUAPIOptions): UseWebRTCViewerSFUAPIReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | null>(null);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [error, setError] = useState<string | null>(null);
  const [controlState, setControlState] = useState<ControlStateUI>('view-only');
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const inputSequenceRef = useRef(0);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteMediaStreamRef = useRef<MediaStream | null>(null);
  // Track previous bytesReceived for delta-based bitrate calculation
  const prevBytesReceivedRef = useRef(0);
  const prevStatsTimestampRef = useRef(0);

  const onControlStateChangeRef = useRef(onControlStateChange);
  const onKickedRef = useRef(onKicked);
  const onPresenceChangeRef = useRef(onPresenceChange);
  const onStreamReadyRef = useRef(onStreamReady);
  const onStreamEndedRef = useRef(onStreamEnded);
  const disconnectRef = useRef<(() => void) | undefined>(undefined);

  onControlStateChangeRef.current = onControlStateChange;
  onKickedRef.current = onKicked;
  onPresenceChangeRef.current = onPresenceChange;
  onStreamReadyRef.current = onStreamReady;
  onStreamEndedRef.current = onStreamEnded;

  // Handle incoming data messages from LiveKit
  // Send data through LiveKit
  const sendData = useCallback((message: unknown, reliable = true) => {
    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    const data = encoder.encode(JSON.stringify(message));
    void room.localParticipant.publishData(data, { reliable });
  }, []);

  const handleDataReceived = useCallback(
    (payload: Uint8Array, _participant?: RemoteParticipant) => {
      try {
        const text = decoder.decode(payload);
        const message = JSON.parse(text) as ControlMessage | KickMessage | MuteMessage;

        if ('type' in message) {
          switch (message.type) {
            case 'tailnet-hello': {
              // Diagnostic only. Reply once with our own addresses so the host
              // can test whether a direct WireGuard path exists; never reply to
              // a reply, or the two sides ping-pong forever.
              if (message.reply) break;
              void getElectronAPI()
                .invoke('tailscale:info', undefined)
                .then((info) => {
                  sendData(buildTailnetHello(participantId, info.ips, true));
                })
                .catch(() => {
                  // Diagnostics must never disturb a session.
                });
              break;
            }
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
              const room = roomRef.current;
              if (room) {
                const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
                if (micPub?.track) {
                  void room.localParticipant.setMicrophoneEnabled(!message.muted);
                  setMicEnabled(!message.muted);
                }
              }
              break;
            }
          }
        }
      } catch {
        // Invalid message
      }
    },
    [participantId, sendData]
  );

  // Request control
  const requestControl = useCallback(() => {
    if (!dataChannelReady) return;

    setControlState('requested');
    onControlStateChangeRef.current?.('requested');

    const message: ControlMessage = {
      type: 'control-request',
      participantId,
      timestamp: Date.now(),
    };
    sendData(message);
  }, [participantId, dataChannelReady, sendData]);

  // Release control
  const releaseControl = useCallback(() => {
    if (!dataChannelReady) return;

    setControlState('view-only');
    onControlStateChangeRef.current?.('view-only');

    const message: ControlMessage = {
      type: 'control-revoke',
      participantId,
      timestamp: Date.now(),
    };
    sendData(message);
  }, [participantId, dataChannelReady, sendData]);

  // Send input event
  const sendInput = useCallback(
    (event: InputEvent) => {
      if (!dataChannelReady || controlState !== 'granted') return;

      const message: InputMessage = {
        type: 'input',
        timestamp: Date.now(),
        sequence: inputSequenceRef.current++,
        event,
      };
      sendData(message);
    },
    [controlState, dataChannelReady, sendData]
  );

  // Collect stats
  const collectStats = useCallback(async () => {
    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    try {
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
          if (pub.kind === Track.Kind.Video && pub.track) {
            const stats = await pub.track.getRTCStatsReport();
            if (!stats) continue;

            let bitrate = 0;
            let frameRate = 0;
            let packetLoss = 0;
            let roundTripTime = 0;
            let packetsLost = 0;
            let packetsReceived = 0;
            let bytesReceived = 0;

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

            if (packetLoss < 1 && roundTripTime < 50) setNetworkQuality('excellent');
            else if (packetLoss < 3 && roundTripTime < 100) setNetworkQuality('good');
            else if (packetLoss < 8 && roundTripTime < 200) setNetworkQuality('poor');
            else setNetworkQuality('bad');

            return;
          }
        }
      }
    } catch {
      // Non-critical
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (roomRef.current) {
      void roomRef.current.disconnect();
      roomRef.current = null;
    }

    remoteMediaStreamRef.current = null;
    setRemoteStream(null);
    setConnectionState('disconnected');
    setQualityMetrics(null);
    setDataChannelReady(false);
    setControlState('view-only');
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  disconnectRef.current = disconnect;

  // Toggle mic
  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const newEnabled = !micEnabled;
    void room.localParticipant.setMicrophoneEnabled(newEnabled);
    setMicEnabled(newEnabled);
  }, [micEnabled]);

  // Initialize: fetch token and connect
  const initialize = useCallback(async () => {
    try {
      setConnectionState('connecting');

      // Get auth token from Electron
      const api = getElectronAPI();
      const { token: authToken } = await api.invoke('auth:getToken', undefined);
      if (!authToken) {
        setError('Authentication required');
        setConnectionState('failed');
        return;
      }

      // Fetch LiveKit token from PairUX API with Bearer auth
      const tokenRes = await fetch(`${API_BASE_URL}/api/livekit/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          sessionId,
          participantName: participantId,
          participantId,
          isHost: false,
        }),
      });

      if (!tokenRes.ok) {
        const err = (await tokenRes.json()) as { error?: string };
        throw new Error(err.error ?? 'Failed to get LiveKit token');
      }

      const { data } = (await tokenRes.json()) as {
        data: { token: string; url: string; roomName: string; iceServers?: RTCIceServer[] };
      };

      // Create and connect room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = room;

      // Track subscribed — host's screen share arrives
      room.on(
        RoomEvent.TrackSubscribed,
        (track, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
            const stream = remoteMediaStreamRef.current ?? new MediaStream();
            remoteMediaStreamRef.current = stream;

            const mediaTrack = track.mediaStreamTrack;
            const hasTrack = stream.getTracks().some((t) => t.id === mediaTrack.id);
            if (!hasTrack) {
              stream.addTrack(mediaTrack);
            }

            setRemoteStream(stream);

            if (track.kind === Track.Kind.Video) {
              onStreamReadyRef.current?.(stream);
            }
          }
        }
      );

      // Track unsubscribed
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
          const stream = remoteMediaStreamRef.current;
          if (!stream) return;

          const mediaTrack = track.mediaStreamTrack;
          const existing = stream.getTracks().find((t) => t.id === mediaTrack.id);
          if (existing) {
            stream.removeTrack(existing);
          }

          if (track.kind === Track.Kind.Video && stream.getVideoTracks().length === 0) {
            onStreamEndedRef.current?.();
          }

          if (stream.getTracks().length === 0) {
            remoteMediaStreamRef.current = null;
            setRemoteStream(null);
          } else {
            setRemoteStream(stream);
          }
        }
      });

      // Connection state changes
      room.on(RoomEvent.ConnectionStateChanged, (state: LKConnectionState) => {
        setConnectionState(mapConnectionState(state));
        if (state === LKConnectionState.Connected) {
          setError(null);
          setDataChannelReady(true);
        } else if (state === LKConnectionState.Disconnected) {
          setDataChannelReady(false);
        }
      });

      // Data messages
      room.on(RoomEvent.DataReceived, handleDataReceived);

      // Detect host disconnect/reconnect
      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        onPresenceChangeRef.current?.();
        try {
          const meta = JSON.parse(participant.metadata ?? '{}') as { role?: string };
          if (meta.role === 'host') {
            setError('Host disconnected. Waiting for reconnection...');
          }
        } catch {
          // metadata parse failed
        }
      });

      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        onPresenceChangeRef.current?.();
        try {
          const meta = JSON.parse(participant.metadata ?? '{}') as { role?: string };
          if (meta.role === 'host') {
            setError(null);
          }
        } catch {
          // metadata parse failed
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnectionState('disconnected');
        setDataChannelReady(false);
      });

      // Connect to LiveKit. Pass the TURN iceServers + honor "Force relay"
      // (same as the host path) — without rtcConfig the subscriber went
      // direct and DTLS-timed-out on restrictive NATs ("could not establish
      // pc connection") even with Force relay enabled.
      await room.connect(data.url, data.token, {
        rtcConfig: buildSfuRtcConfig(data.iceServers),
      });

      // Enable mic after connecting
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setHasMic(true);
        setMicEnabled(true);
      } catch {
        setHasMic(false);
        setMicEnabled(false);
      }

      // Open the tailnet handshake now the room can carry data. Fire and
      // forget: the host draws the conclusion, and nothing here depends on it.
      void announceTailnet(participantId, (message) => {
        sendData(message);
      });

      // Start stats collection
      statsIntervalRef.current = setInterval(() => void collectStats(), 2000);
    } catch (err) {
      console.error('[WebRTCViewerSFU] Connection failed:', err);
      setConnectionState('failed');
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [sessionId, participantId, handleDataReceived, collectStats, sendData]);

  // Manual reconnect
  const reconnect = useCallback(() => {
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
    micEnabled,
    hasMic,
    toggleMic,
  };
}
