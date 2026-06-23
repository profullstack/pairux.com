import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState as LKConnectionState,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
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

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? '';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface UseWebRTCSFUOptions {
  sessionId: string;
  participantId: string;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnded?: () => void;
  onControlStateChange?: (state: ControlStateUI) => void;
  onCursorUpdate?: (cursor: CursorPositionMessage) => void;
  onKicked?: (reason?: string) => void;
}

interface UseWebRTCSFUReturn {
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

export function useWebRTCSFU({
  sessionId,
  participantId,
  onStreamReady,
  onStreamEnded,
  onControlStateChange,
  onCursorUpdate,
  onKicked,
}: UseWebRTCSFUOptions): UseWebRTCSFUReturn {
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
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const remoteMediaStreamRef = useRef<MediaStream | null>(null);

  const onControlStateChangeRef = useRef(onControlStateChange);
  const onCursorUpdateRef = useRef(onCursorUpdate);
  const onKickedRef = useRef(onKicked);
  const onStreamReadyRef = useRef(onStreamReady);
  const onStreamEndedRef = useRef(onStreamEnded);
  const disconnectRef = useRef<(() => void) | undefined>(undefined);

  onControlStateChangeRef.current = onControlStateChange;
  onCursorUpdateRef.current = onCursorUpdate;
  onKickedRef.current = onKicked;
  onStreamReadyRef.current = onStreamReady;
  onStreamEndedRef.current = onStreamEnded;

  // Handle incoming data messages from LiveKit
  const handleDataReceived = useCallback(
    (payload: Uint8Array, participant?: RemoteParticipant) => {
      try {
        const text = decoder.decode(payload);
        const message = JSON.parse(text) as
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
              // Ignore cursor updates from ourselves
              if (participant?.identity !== participantId) {
                onCursorUpdateRef.current?.(message);
              }
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
        // Invalid message - ignore
      }
    },
    [participantId]
  );

  // Send a data message through LiveKit
  const sendData = useCallback((message: unknown, reliable = true) => {
    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    const data = encoder.encode(JSON.stringify(message));
    void room.localParticipant.publishData(data, { reliable });
  }, []);

  // Request control from host
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

  // Send cursor position (lossy - high frequency, okay to drop)
  const sendCursorPosition = useCallback(
    (x: number, y: number, visible: boolean) => {
      if (!dataChannelReady) return;

      const message: CursorPositionMessage = {
        type: 'cursor',
        participantId,
        x,
        y,
        visible,
      };
      sendData(message, false); // lossy for cursor updates
    },
    [participantId, dataChannelReady, sendData]
  );

  // Collect stats
  const collectStats = useCallback(async () => {
    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    try {
      // Get stats from subscribed video tracks
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
            bitrate = bytesReceived * 8;

            const metrics: QualityMetrics = {
              bitrate,
              frameRate,
              packetLoss,
              roundTripTime,
            };

            setQualityMetrics(metrics);

            if (packetLoss < 1 && roundTripTime < 50) {
              setNetworkQuality('excellent');
            } else if (packetLoss < 3 && roundTripTime < 100) {
              setNetworkQuality('good');
            } else if (packetLoss < 8 && roundTripTime < 200) {
              setNetworkQuality('poor');
            } else {
              setNetworkQuality('bad');
            }

            // Only need stats from first video track
            return;
          }
        }
      }
    } catch {
      // Stats collection is non-critical
    }
  }, []);

  // Disconnect from room
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

  // Toggle microphone
  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const newEnabled = !micEnabled;
    void room.localParticipant.setMicrophoneEnabled(newEnabled);
    setMicEnabled(newEnabled);
  }, [micEnabled]);

  // Initialize: fetch token and connect to LiveKit room
  const initialize = useCallback(async () => {
    try {
      setConnectionState('connecting');

      // Fetch LiveKit token from our API
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          participantName: participantId, // Will be overridden by display name if available
          participantId,
          isHost: false,
        }),
      });

      if (!tokenRes.ok) {
        const err = (await tokenRes.json()) as { error?: string };
        throw new Error(err.error ?? 'Failed to get LiveKit token');
      }

      const { data } = (await tokenRes.json()) as {
        data: { token: string; url: string; roomName: string };
      };

      // Create and connect room.
      // adaptiveStream pauses video tracks that livekit doesn't see attached to
      // a visible element via track.attach(). We render through a manually built
      // MediaStream on a <video> srcObject, so livekit never registers the
      // element and would pause the screen-share video — audio keeps flowing,
      // video stays black. Disable it: the viewer always shows the one presenter
      // stream, so there's nothing to adaptively pause.
      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
      });

      roomRef.current = room;

      // Track subscribed - host's screen share arrives.
      room.on(
        RoomEvent.TrackSubscribed,
        (track, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
            const mediaTrack = track.mediaStreamTrack;
            const existingTracks = remoteMediaStreamRef.current?.getTracks() ?? [];
            if (existingTracks.some((t) => t.id === mediaTrack.id)) return;

            // Emit a NEW MediaStream reference on every track change. React bails
            // on setState with the same object, so the <video>'s srcObject effect
            // never re-runs — and Firefox does NOT render a track added to a
            // MediaStream that is already attached to a video element. With audio
            // often subscribed before the screen-share video, that left the
            // screen black. A fresh reference forces srcObject to re-bind.
            const nextStream = new MediaStream([...existingTracks, mediaTrack]);
            remoteMediaStreamRef.current = nextStream;
            setRemoteStream(nextStream);

            if (track.kind === Track.Kind.Video) {
              onStreamReadyRef.current?.(nextStream);
            }
          }
        }
      );

      // Track unsubscribed - host disconnected or stopped sharing.
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
          const prev = remoteMediaStreamRef.current;
          if (!prev) return;

          const mediaTrack = track.mediaStreamTrack;
          const remaining = prev.getTracks().filter((t) => t.id !== mediaTrack.id);
          if (remaining.length === prev.getTracks().length) return; // not present

          if (track.kind === Track.Kind.Video && !remaining.some((t) => t.kind === 'video')) {
            onStreamEndedRef.current?.();
          }

          if (remaining.length === 0) {
            remoteMediaStreamRef.current = null;
            setRemoteStream(null);
          } else {
            const nextStream = new MediaStream(remaining);
            remoteMediaStreamRef.current = nextStream;
            setRemoteStream(nextStream);
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

      // Participant disconnected (detect host leaving)
      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        // Check if it was the host by metadata
        try {
          const meta = JSON.parse(participant.metadata ?? '{}') as { role?: string };
          if (meta.role === 'host') {
            // Host left - stream already handled by TrackUnsubscribed
            // Room stays alive via SFU, viewer stays connected
            setError('Host disconnected. Waiting for reconnection...');
          }
        } catch {
          // metadata parse failed
        }
      });

      // Host reconnected
      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        try {
          const meta = JSON.parse(participant.metadata ?? '{}') as { role?: string };
          if (meta.role === 'host') {
            setError(null);
          }
        } catch {
          // metadata parse failed
        }
      });

      // Connection error
      room.on(RoomEvent.Disconnected, () => {
        setConnectionState('disconnected');
        setDataChannelReady(false);
      });

      // Connect to LiveKit
      await room.connect(data.url || LIVEKIT_URL, data.token);

      // Capture mic after connecting
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setHasMic(true);
        setMicEnabled(true);
      } catch {
        setHasMic(false);
        setMicEnabled(false);
      }

      // Start stats collection
      statsIntervalRef.current = setInterval(() => void collectStats(), 2000);
    } catch (err) {
      console.error('[WebRTC SFU] Connection failed:', err);
      setConnectionState('failed');
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [sessionId, participantId, handleDataReceived, collectStats]);

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
    sendCursorPosition,
    micEnabled,
    hasMic,
    toggleMic,
  };
}
