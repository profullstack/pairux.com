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
import { amplifyRemoteAudio, type AmplifiedAudioTrack } from '@/lib/remoteAudioGain';
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
  /**
   * Mute or unmute every remote participant at once.
   *
   * Remote audio no longer travels inside `remoteStream`, so muting the video
   * element no longer silences anybody. The speaker toggle has to reach the
   * per-participant elements instead.
   */
  setSpeakerMuted: (muted: boolean) => void;
}

/**
 * One remote participant's audio playback.
 *
 * Each subscribed audio track gets its own element and its own gain stage,
 * mirroring how the host already plays viewers back. See `attachRemoteAudio`
 * for why they cannot share one.
 */
interface RemoteAudioPlayback {
  track: MediaStreamTrack;
  element: HTMLAudioElement;
  amplified: AmplifiedAudioTrack;
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
  // Remote audio, one entry per subscribed track, keyed by track id.
  const remoteAudioRef = useRef(new Map<string, RemoteAudioPlayback>());
  const speakerMutedRef = useRef(false);
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

  /**
   * Give one remote participant their own audio element.
   *
   * Every subscribed track used to be folded into the single `MediaStream`
   * behind the `<video>` element, and a media element plays only the *first*
   * audio track a stream carries. With one other person in the room that is
   * invisible — there is only ever one. With three, each viewer heard whichever
   * of the other two was subscribed first, and the other stayed silent for the
   * whole session.
   *
   * So audio is played per participant, exactly as the host already plays its
   * viewers back, and `remoteStream` carries video only.
   */
  const attachRemoteAudio = useCallback((track: MediaStreamTrack) => {
    if (remoteAudioRef.current.has(track.id)) return;

    // An element's volume tops out at 1.0, so the track passes through a gain
    // stage first — the same one the host uses, for the same reason.
    const amplified = amplifyRemoteAudio(track);

    const element = new Audio();
    element.srcObject = amplified.stream;
    element.autoplay = true;
    element.volume = 1.0;
    element.muted = speakerMutedRef.current;
    // Wrapped because `play()` predates its own promise and still returns
    // undefined on some implementations; a bare `.catch` there would throw.
    void Promise.resolve(element.play()).catch((err: unknown) => {
      console.warn('[WebRTCViewerSFU] Failed to play remote audio:', err);
    });

    remoteAudioRef.current.set(track.id, { track, element, amplified });
    console.log('[WebRTCViewerSFU] Remote audio attached', {
      trackId: track.id,
      total: remoteAudioRef.current.size,
    });
  }, []);

  /** Stop and tear down one participant's playback. */
  const detachRemoteAudio = useCallback((trackId: string) => {
    const playback = remoteAudioRef.current.get(trackId);
    if (!playback) return;

    playback.element.pause();
    playback.element.srcObject = null;
    playback.amplified.dispose();
    remoteAudioRef.current.delete(trackId);
    console.log('[WebRTCViewerSFU] Remote audio detached', {
      trackId,
      total: remoteAudioRef.current.size,
    });
  }, []);

  /** Tear down every participant's playback. */
  const detachAllRemoteAudio = useCallback(() => {
    for (const trackId of [...remoteAudioRef.current.keys()]) {
      detachRemoteAudio(trackId);
    }
  }, [detachRemoteAudio]);

  /**
   * Mute or unmute every remote participant.
   *
   * Elements are created as tracks arrive, so the wanted state is held in a ref
   * and applied to whoever joins later as well.
   */
  const setSpeakerMuted = useCallback((muted: boolean) => {
    speakerMutedRef.current = muted;
    for (const playback of remoteAudioRef.current.values()) {
      playback.element.muted = muted;
    }
  }, []);

  // Handle incoming data messages from LiveKit
  // Send data through LiveKit
  /**
   * Send to the room, or to one participant when `targetIdentity` is given.
   *
   * Control messages must be addressed. Broadcasting them means the other
   * *viewers* act on decisions that were never about them: an untargeted
   * `control-revoke` from whoever was driving put every other guest into
   * `view-only` too, so releasing control silently stripped it from the
   * person who actually held it. Harmless with one guest, wrong with two.
   */
  const sendData = useCallback((message: unknown, reliable = true, targetIdentity?: string) => {
    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    const data = encoder.encode(JSON.stringify(message));
    const opts: { reliable: boolean; destinationIdentities?: string[] } = { reliable };
    if (targetIdentity) {
      opts.destinationIdentities = [targetIdentity];
    }
    void room.localParticipant.publishData(data, opts);
  }, []);

  /**
   * The identity of whoever is publishing screen video, i.e. the peer that
   * control messages and input belong to.
   *
   * Everything a guest sends about control is for the presenter alone. Falling
   * back to the participant marked `host` in metadata keeps a voice-only
   * session (nobody sharing yet) working.
   */
  const findHostIdentity = useCallback((): string | undefined => {
    const room = roomRef.current;
    if (!room) return undefined;

    let hostByMetadata: string | undefined;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        if (publication.source === Track.Source.ScreenShare) return participant.identity;
      }
      if (hostByMetadata === undefined) {
        try {
          const meta = JSON.parse(participant.metadata ?? '{}') as { role?: string };
          if (meta.role === 'host') hostByMetadata = participant.identity;
        } catch {
          // metadata parse failed; fall through
        }
      }
    }
    return hostByMetadata;
  }, []);

  const handleDataReceived = useCallback(
    (payload: Uint8Array, sender?: RemoteParticipant) => {
      try {
        const text = decoder.decode(payload);
        const message = JSON.parse(text) as ControlMessage | KickMessage | MuteMessage;

        if ('type' in message) {
          // A control decision names who it is about. Acting on one addressed
          // to somebody else is how a third participant in the room lost the
          // control they had been granted: a guest releasing control broadcast
          // `control-revoke`, and every other guest applied it to themselves.
          //
          // `tailnet-hello` is excluded because its `participantId` is the
          // *sender*, not the addressee — it is a greeting, and dropping it
          // here would silently kill the handshake. `kick` omits the field and
          // is addressed by delivery alone.
          const addressee = (message as { participantId?: unknown }).participantId;
          if (
            message.type !== 'tailnet-hello' &&
            typeof addressee === 'string' &&
            addressee !== participantId
          ) {
            return;
          }

          switch (message.type) {
            case 'tailnet-hello': {
              // Diagnostic only. Reply once with our own addresses so the host
              // can test whether a direct WireGuard path exists; never reply to
              // a reply, or the two sides ping-pong forever.
              if (message.reply) break;
              const replyTo = sender?.identity;
              void getElectronAPI()
                .invoke('tailscale:info', undefined)
                .then((info) => {
                  sendData(buildTailnetHello(participantId, info.ips, true), true, replyTo);
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
    sendData(message, true, findHostIdentity());
  }, [participantId, dataChannelReady, sendData, findHostIdentity]);

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
    sendData(message, true, findHostIdentity());
  }, [participantId, dataChannelReady, sendData, findHostIdentity]);

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
      // Pointer motion and trackpad scroll are superseded by the next sample.
      // Send them as datagrams so congestion drops stale movement instead of
      // queueing it behind a flood of reliable data packets.
      const isContinuous =
        event.type === 'mouse' && (event.action === 'move' || event.action === 'scroll');
      // Addressed to the presenter. Input runs at up to 60 messages a second
      // and only one machine can act on it; broadcasting sent every keystroke
      // and mouse position to every other guest in the room as well.
      sendData(message, !isContinuous, findHostIdentity());
    },
    [controlState, dataChannelReady, sendData, findHostIdentity]
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

    // Every participant's playback holds an element and a Web Audio graph;
    // leaving them behind leaks a device connection per reconnect.
    detachAllRemoteAudio();

    remoteMediaStreamRef.current = null;
    setRemoteStream(null);
    setConnectionState('disconnected');
    setQualityMetrics(null);
    setDataChannelReady(false);
    setControlState('view-only');
    setMicEnabled(false);
    setHasMic(false);
  }, [detachAllRemoteAudio]);

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

      // Create and connect room.
      // adaptiveStream pauses video tracks that livekit doesn't see attached to
      // a visible element via track.attach(). We render through a manually built
      // MediaStream on a <video> srcObject, so livekit never registers the
      // element and would pause the screen-share video mid-session — audio keeps
      // flowing, video freezes then goes black. Disable it: the viewer always
      // shows the one presenter stream, so there's nothing to adaptively pause.
      // apps/web/src/hooks/useWebRTCSFU.ts made this same fix (#29).
      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
      });

      roomRef.current = room;

      // Track subscribed — host's screen share arrives
      room.on(
        RoomEvent.TrackSubscribed,
        (track, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          const mediaTrack = track.mediaStreamTrack;

          // Audio plays through its own element, one per participant, so that
          // a third person in the room is not silently dropped. See
          // attachRemoteAudio.
          if (track.kind === Track.Kind.Audio) {
            attachRemoteAudio(mediaTrack);
            return;
          }

          if (track.kind !== Track.Kind.Video) return;

          const existingTracks = remoteMediaStreamRef.current?.getTracks() ?? [];
          if (existingTracks.some((t) => t.id === mediaTrack.id)) return;

          // Emit a NEW MediaStream reference on every track change. React bails
          // on setState with the same object, so VideoViewer's srcObject effect
          // (keyed on the stream identity) never re-runs — and a track added to
          // a MediaStream that is already attached to a <video> is not reliably
          // rendered. When a host stops and restarts sharing, a stream that
          // survived in place was invisible to the viewer while the host's own
          // preview looked fine. A fresh reference forces srcObject to re-bind.
          const nextStream = new MediaStream([...existingTracks, mediaTrack]);
          remoteMediaStreamRef.current = nextStream;
          setRemoteStream(nextStream);
          onStreamReadyRef.current?.(nextStream);
        }
      );

      // Track unsubscribed
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        const mediaTrack = track.mediaStreamTrack;

        if (track.kind === Track.Kind.Audio) {
          detachRemoteAudio(mediaTrack.id);
          return;
        }

        if (track.kind !== Track.Kind.Video) return;

        const prev = remoteMediaStreamRef.current;
        if (!prev) return;

        const remaining = prev.getTracks().filter((t) => t.id !== mediaTrack.id);
        if (remaining.length === prev.getTracks().length) return; // not present

        if (!remaining.some((t) => t.kind === 'video')) {
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
  }, [
    sessionId,
    participantId,
    handleDataReceived,
    collectStats,
    sendData,
    attachRemoteAudio,
    detachRemoteAudio,
  ]);

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
    setSpeakerMuted,
  };
}
