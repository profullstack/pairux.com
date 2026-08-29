import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState as LKConnectionState,
  type RemoteParticipant,
  type LocalTrackPublication,
} from 'livekit-client';
import type {
  ConnectionState,
  NetworkQuality,
  InputMessage,
  ControlMessage,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';
import { DEFAULT_REMOTE_AUDIO_GAIN } from '@pairux/shared-types';
import { amplifyRemoteAudio, type AmplifiedAudioTrack } from '@/lib/remoteAudioGain';

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? '';

/**
 * Did this publish fail only because the track is already on the air?
 *
 * livekit signals it as `TrackInvalidError: a track with the same ID has
 * already been published`. There is no error code to match on, so the message
 * is the only handle — matched loosely enough to survive rewording, and
 * deliberately narrow enough not to swallow a genuine publish failure.
 */
function isAlreadyPublished(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /already been published|already publish/i.test(message);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ViewerConnection {
  id: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connectionState: ConnectionState;
  controlState: 'view-only' | 'requested' | 'granted';
  networkQuality: NetworkQuality;
  currentPreset: NetworkQuality;
  audioTrack: MediaStreamTrack | null;
  audioElement: HTMLAudioElement | null;
  /** Gain stage feeding {@link audioElement}, so playback can exceed unity. */
  amplifiedAudio: AmplifiedAudioTrack | null;
  isMuted: boolean;
}

interface UseWebRTCHostSFUOptions {
  sessionId: string;
  hostId: string;
  localStream: MediaStream | null;
  allowControl?: boolean;
  onViewerJoined?: (viewerId: string) => void;
  onViewerLeft?: (viewerId: string) => void;
  onControlRequest?: (viewerId: string) => void;
  onInputReceived?: (viewerId: string, input: InputMessage) => void;
}

interface UseWebRTCHostSFUReturn {
  isHosting: boolean;
  viewerCount: number;
  viewers: Map<string, ViewerConnection>;
  controllingViewer: string | null;
  error: string | null;
  startHosting: () => Promise<void>;
  stopHosting: () => void;
  /**
   * Publish the presentation stream. `isStale` is polled once the call reaches
   * the front of the publish queue: return true to abandon a publication whose
   * capture session has already been replaced or torn down.
   */
  publishStream: (stream: MediaStream, isStale?: () => boolean) => Promise<void>;
  unpublishStream: () => Promise<void>;
  grantControl: (viewerId: string) => void;
  revokeControl: (viewerId: string) => void;
  kickViewer: (viewerId: string) => void;
  muteViewer: (viewerId: string, muted: boolean) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
  micStream: MediaStream | null;
}

export function useWebRTCHostSFU({
  sessionId,
  hostId,
  localStream,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
}: UseWebRTCHostSFUOptions): UseWebRTCHostSFUReturn {
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [controllingViewer, setControllingViewer] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const roomRef = useRef<Room | null>(null);
  // Serialises every mutation of the screen-share publication — see publishStream.
  const publishQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Current playback gain, so a viewer who joins later starts at the level the
  // host already chose rather than snapping back to the default.
  const speakerGainRef = useRef<number>(DEFAULT_REMOTE_AUDIO_GAIN);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());

  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);
  const onViewerJoinedRef = useRef(onViewerJoined);
  const onViewerLeftRef = useRef(onViewerLeft);

  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;
  onViewerJoinedRef.current = onViewerJoined;
  onViewerLeftRef.current = onViewerLeft;

  // Send data to a specific participant or all
  const sendData = useCallback((message: unknown, targetIdentity?: string, reliable = true) => {
    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    const data = encoder.encode(JSON.stringify(message));
    const opts: { reliable: boolean; destinationIdentities?: string[] } = { reliable };
    if (targetIdentity) {
      opts.destinationIdentities = [targetIdentity];
    }
    void room.localParticipant.publishData(data, opts);
  }, []);

  // Handle data messages from viewers
  const handleDataReceived = useCallback((payload: Uint8Array, participant?: RemoteParticipant) => {
    if (!participant) return;
    const viewerId = participant.identity;

    try {
      const text = decoder.decode(payload);
      const message = JSON.parse(text) as ControlMessage | InputMessage;

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
      // Invalid message - ignore
    }
  }, []);

  // Create a ViewerConnection entry for a remote participant
  /**
   * Route a viewer's audio to the host's speakers. Replaces any previous
   * element, so it is safe to call for a track that is already playing.
   */
  const attachViewerAudio = useCallback((viewer: ViewerConnection, track: MediaStreamTrack) => {
    viewer.audioTrack = track;

    if (viewer.audioElement) {
      viewer.audioElement.pause();
      viewer.audioElement.srcObject = null;
    }

    viewer.amplifiedAudio?.dispose();

    // An element's volume tops out at 1.0, so the track passes through a gain
    // stage first — otherwise a quiet talker can only be muted, never raised.
    const amplified = amplifyRemoteAudio(track, speakerGainRef.current);
    viewer.amplifiedAudio = amplified;

    const audioEl = new Audio();
    audioEl.srcObject = amplified.stream;
    audioEl.autoplay = true;
    audioEl.volume = 1.0;
    audioEl.muted = viewer.isMuted;
    void audioEl.play().catch((err: unknown) => {
      console.warn('[WebRTCHostSFU] Failed to play viewer audio:', err);
    });

    viewer.audioElement = audioEl;
  }, []);

  const addViewer = useCallback(
    (participant: RemoteParticipant) => {
      if (viewersRef.current.has(participant.identity)) return;

      // Create a stub ViewerConnection - no direct peer connection in SFU mode
      const viewer: ViewerConnection = {
        id: participant.identity,
        peerConnection: null as unknown as RTCPeerConnection, // Not used in SFU mode
        dataChannel: null,
        connectionState: 'connected',
        controlState: 'view-only',
        networkQuality: 'good',
        currentPreset: 'good',
        audioTrack: null,
        audioElement: null,
        amplifiedAudio: null,
        isMuted: false,
      };

      viewersRef.current.set(participant.identity, viewer);

      // A participant already in the room when we connect has their tracks
      // subscribed during connect(), so TrackSubscribed may already have fired
      // and found no viewer entry. Pick up anything already subscribed.
      for (const publication of participant.audioTrackPublications.values()) {
        const existing = publication.track?.mediaStreamTrack;
        if (existing) {
          attachViewerAudio(viewer, existing);
          break;
        }
      }

      setViewers(new Map(viewersRef.current));
      onViewerJoinedRef.current?.(participant.identity);
    },
    [attachViewerAudio]
  );

  // Remove a viewer
  const removeViewer = useCallback((identity: string) => {
    if (!viewersRef.current.has(identity)) return;

    const viewer = viewersRef.current.get(identity);
    if (viewer?.audioElement) {
      viewer.audioElement.pause();
      viewer.audioElement.srcObject = null;
    }

    viewersRef.current.delete(identity);
    setViewers(new Map(viewersRef.current));
    setControllingViewer((prev) => (prev === identity ? null : prev));
    onViewerLeftRef.current?.(identity);
  }, []);

  // Start hosting (sets up LiveKit room and voice -- screen sharing is optional)
  const startHosting = useCallback(async () => {
    try {
      // Fetch LiveKit token
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          participantName: hostId,
          participantId: hostId,
          isHost: true,
        }),
      });

      if (!tokenRes.ok) {
        const err = (await tokenRes.json()) as { error?: string };
        throw new Error(err.error ?? 'Failed to get LiveKit token');
      }

      const { data } = (await tokenRes.json()) as {
        data: { token: string; url: string; roomName: string };
      };

      // Create room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = room;

      // Track viewer connections
      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        addViewer(participant);
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        removeViewer(participant.identity);
      });

      // Handle viewer audio tracks (for host to hear viewers)
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;

        // Audio can be subscribed before the viewer is registered (tracks are
        // subscribed during connect(), while participants already in the room
        // are enumerated after it). Register them rather than dropping the
        // track, which left that viewer permanently silent.
        if (!viewersRef.current.has(participant.identity)) {
          addViewer(participant);
        }

        const viewer = viewersRef.current.get(participant.identity);
        if (!viewer) {
          console.warn('[WebRTCHostSFU] Dropping viewer audio: no viewer entry', {
            viewerId: participant.identity,
          });
          return;
        }

        attachViewerAudio(viewer, track.mediaStreamTrack);
        setViewers(new Map(viewersRef.current));
      });

      // Data messages from viewers
      room.on(RoomEvent.DataReceived, handleDataReceived);

      // Connection state
      room.on(RoomEvent.ConnectionStateChanged, (state: LKConnectionState) => {
        if (state === LKConnectionState.Disconnected) {
          setIsHosting(false);
          setError('Disconnected from server');
        }
      });

      // Connect to LiveKit
      await room.connect(data.url || LIVEKIT_URL, data.token);

      // Capture and publish host microphone
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setHasMic(true);
        setMicEnabled(true);
      } catch {
        setHasMic(false);
        setMicEnabled(false);
      }

      // Track existing participants who joined before us
      for (const participant of room.remoteParticipants.values()) {
        addViewer(participant);
      }

      setIsHosting(true);
      setError(null);
    } catch (err) {
      console.error('[WebRTCHostSFU] Failed to start hosting:', err);
      setError(err instanceof Error ? err.message : 'Failed to start hosting');
    }
  }, [sessionId, hostId, addViewer, attachViewerAudio, removeViewer, handleDataReceived]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      // Unpublish all tracks but keep room alive for viewers. Snapshot first:
      // unpublishTrack deletes from trackPublications, and walking a Map while
      // deleting from it skips entries.
      for (const pub of Array.from(room.localParticipant.trackPublications.values())) {
        if (pub.track) {
          void room.localParticipant.unpublishTrack(pub.track);
        }
      }
      void room.disconnect();
      roomRef.current = null;
    }

    viewersRef.current.forEach((viewer) => {
      if (viewer.audioElement) {
        viewer.audioElement.pause();
        viewer.audioElement.srcObject = null;
      }
    });
    viewersRef.current.clear();
    setViewers(new Map());

    setIsHosting(false);
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  /**
   * Run `op` with exclusive access to the screen-share publication.
   *
   * See the desktop host (useWebRTCHostSFUAPI) for the full story: deciding
   * replace-vs-publish is a read followed by an await, so two overlapping
   * callers both decide "publish" and livekit rejects the loser with
   * `TrackInvalidError: a track with the same ID has already been published`.
   * The queue must never settle rejected or every later op would be dropped,
   * so the stored tail always swallows; the caller still sees its own error.
   */
  const enqueuePublishOp = useCallback((op: () => Promise<void>): Promise<void> => {
    const run = publishQueueRef.current.then(op, op);
    publishQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  /**
   * Publish a screen share stream to the LiveKit room.
   *
   * Replaces the track inside an existing publication rather than adding a
   * second one: viewers fold every subscribed video track into one MediaStream
   * and a <video> renders only the first, so a second publication is invisible
   * to them and the host appears frozen on the pre-republish frame.
   */
  const publishStream = useCallback(
    (stream: MediaStream, isStale?: () => boolean): Promise<void> =>
      enqueuePublishOp(async () => {
        if (isStale?.()) {
          console.log('[WebRTCHostSFU] Skipping stale publish (capture session changed)');
          return;
        }

        const room = roomRef.current;
        if (room?.state !== LKConnectionState.Connected) {
          console.warn('[WebRTCHostSFU] Cannot publish stream: room not connected');
          return;
        }

        const publicationFor = (source: Track.Source): LocalTrackPublication | undefined =>
          Array.from(room.localParticipant.trackPublications.values()).find(
            (pub: LocalTrackPublication) => pub.source === source
          );

        for (const track of stream.getTracks()) {
          const source =
            track.kind === 'video' ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio;

          try {
            if (track.kind === 'video') {
              track.contentHint = 'detail';
            }

            const existing = publicationFor(source);
            if (existing?.track) {
              if (existing.track.mediaStreamTrack.id === track.id) continue;

              await existing.track.replaceTrack(track);
              console.log('[WebRTCHostSFU] Replaced published track', {
                source,
                trackId: track.id,
              });
              continue;
            }

            console.log('[WebRTCHostSFU] Publishing track', { source, trackId: track.id });

            if (track.kind === 'video') {
              await room.localParticipant.publishTrack(track, {
                source: Track.Source.ScreenShare,
                simulcast: false,
                videoEncoding: {
                  maxBitrate: 8_000_000,
                  maxFramerate: 60,
                },
              });
            } else if (track.kind === 'audio') {
              await room.localParticipant.publishTrack(track, {
                source: Track.Source.ScreenShareAudio,
              });
            }
          } catch (err) {
            // Losing a publish race is not a failure: the track this call wanted
            // on the air is already on the air.
            if (isAlreadyPublished(err)) {
              console.log('[WebRTCHostSFU] Track already published — treating as success', {
                trackId: track.id,
              });
              continue;
            }
            throw err;
          }
        }
      }),
    [enqueuePublishOp]
  );

  // Unpublish screen share tracks (room stays connected, mic stays enabled).
  // Shares publishStream's queue so a stop/start pair straddling a reconnect
  // cannot unpublish the track the restart just put on the air.
  const unpublishStream = useCallback(
    (): Promise<void> =>
      enqueuePublishOp(async () => {
        const room = roomRef.current;
        if (!room) return;

        const pubs = Array.from(room.localParticipant.trackPublications.values());
        for (const pub of pubs) {
          if (
            pub.source === Track.Source.ScreenShare ||
            pub.source === Track.Source.ScreenShareAudio
          ) {
            if (pub.track) {
              await room.localParticipant.unpublishTrack(pub.track);
            }
          }
        }
      }),
    [enqueuePublishOp]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);

  // Update published tracks when stream changes via prop
  useEffect(() => {
    if (!localStream || !isHosting) return;

    const room = roomRef.current;
    if (room?.state !== LKConnectionState.Connected) return;

    // Replace published video track with new one
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const existingPub = Array.from(room.localParticipant.trackPublications.values()).find(
        (pub: LocalTrackPublication) => pub.source === Track.Source.ScreenShare
      );

      if (existingPub?.track) {
        // Replace the track in the existing publication
        void existingPub.track.replaceTrack(videoTrack);
      }
    }
  }, [localStream, isHosting]);

  // Toggle host microphone
  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const newEnabled = !micEnabled;
    void room.localParticipant.setMicrophoneEnabled(newEnabled);
    setMicEnabled(newEnabled);
  }, [micEnabled]);

  // Grant control to a viewer
  const grantControl = useCallback(
    (viewerId: string) => {
      if (!viewersRef.current.has(viewerId)) return;

      // Revoke from previous controller
      if (controllingViewer && controllingViewer !== viewerId) {
        const revokeMessage: ControlMessage = {
          type: 'control-revoke',
          participantId: controllingViewer,
          timestamp: Date.now(),
        };
        sendData(revokeMessage, controllingViewer);

        const prevViewer = viewersRef.current.get(controllingViewer);
        if (prevViewer) prevViewer.controlState = 'view-only';
      }

      // Grant to new viewer
      const grantMessage: ControlMessage = {
        type: 'control-grant',
        participantId: viewerId,
        timestamp: Date.now(),
      };
      sendData(grantMessage, viewerId);

      const viewer = viewersRef.current.get(viewerId);
      if (viewer) viewer.controlState = 'granted';

      setControllingViewer(viewerId);
      setViewers(new Map(viewersRef.current));
    },
    [controllingViewer, sendData]
  );

  // Revoke control
  const revokeControl = useCallback(
    (viewerId: string) => {
      const message: ControlMessage = {
        type: 'control-revoke',
        participantId: viewerId,
        timestamp: Date.now(),
      };
      sendData(message, viewerId);

      const viewer = viewersRef.current.get(viewerId);
      if (viewer) viewer.controlState = 'view-only';

      setControllingViewer((prev) => (prev === viewerId ? null : prev));
      setViewers(new Map(viewersRef.current));
    },
    [sendData]
  );

  // Kick a viewer
  const kickViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (!viewer) return;

      // Send kick message
      const message: KickMessage = {
        type: 'kick',
        timestamp: Date.now(),
      };
      sendData(message, viewerId);

      // Clean up
      if (controllingViewer === viewerId) {
        setControllingViewer(null);
      }

      if (viewer.audioElement) {
        viewer.audioElement.pause();
        viewer.audioElement.srcObject = null;
      }

      viewersRef.current.delete(viewerId);
      setViewers(new Map(viewersRef.current));
      onViewerLeftRef.current?.(viewerId);
    },
    [controllingViewer, sendData]
  );

  // Mute/unmute a viewer
  const muteViewer = useCallback(
    (viewerId: string, muted: boolean) => {
      const viewer = viewersRef.current.get(viewerId);
      if (!viewer) return;

      const message: MuteMessage = {
        type: 'mute',
        participantId: viewerId,
        muted,
        timestamp: Date.now(),
      };
      sendData(message, viewerId);

      if (viewer.audioElement) {
        viewer.audioElement.muted = muted;
      }

      viewer.isMuted = muted;
      setViewers(new Map(viewersRef.current));
    },
    [sendData]
  );

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
    micStream: null, // LiveKit manages mic internally
  };
}
