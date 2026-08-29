/**
 * WebRTC Host Hook using LiveKit SFU with API-based token fetching
 *
 * Desktop variant of useWebRTCHostSFU. Uses HTTP Bearer token auth
 * to fetch LiveKit tokens from the PairUX API, matching the pattern
 * used by useWebRTCHostAPI for P2P sessions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState as LKConnectionState,
  type RemoteParticipant,
  type LocalTrackPublication,
} from 'livekit-client';
import { API_BASE_URL } from '../../shared/config';
import { getElectronAPI } from '@/lib/ipc';
import { buildSfuRtcConfig } from '@/lib/iceConfig';
import type {
  ConnectionState,
  NetworkQuality,
  InputMessage,
  ControlMessage,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';
import {
  VOICE_AUDIO_CONSTRAINTS,
  DEFAULT_REMOTE_AUDIO_GAIN,
  markTrackAsSpeech,
} from '@pairux/shared-types';
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
const REJECTED_INPUT_LOG_INTERVAL_MS = 5_000;
const MAX_CONTROL_MESSAGE_BYTES = 16 * 1024;

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

interface UseWebRTCHostSFUAPIOptions {
  sessionId: string;
  hostId: string;
  /**
   * The raw capture stream. Retained so callers keep a single options shape
   * across the P2P and SFU hooks; publishing is driven entirely by
   * `publishStream()`, which is handed the *presentation* track instead.
   */
  localStream: MediaStream | null;
  allowControl?: boolean;
  onViewerJoined?: (viewerId: string) => void;
  onViewerLeft?: (viewerId: string) => void;
  onControlRequest?: (viewerId: string) => void;
  onInputReceived?: (viewerId: string, input: InputMessage) => void;
  /** A peer reporting its tailnet addresses (diagnostic only). */
  onTailnetHello?: (viewerId: string, ips: string[], isReply: boolean) => void;
}

interface UseWebRTCHostSFUAPIReturn {
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
  sendTailnetHello: (viewerId: string, ips: string[], reply: boolean) => void;
  revokeControl: (viewerId: string) => void;
  kickViewer: (viewerId: string) => void;
  muteViewer: (viewerId: string, muted: boolean) => void;
  // Host microphone
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
  /** The host's dedicated microphone stream — alive whenever hosting, independent of screen sharing. */
  hostMicStream: MediaStream | null;
  /** Playback gain for remote participants. Can exceed 1.0. */
  setSpeakerGain: (gain: number) => void;
}

export function useWebRTCHostSFUAPI({
  sessionId,
  hostId,
  allowControl = false,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
  onTailnetHello,
}: UseWebRTCHostSFUAPIOptions): UseWebRTCHostSFUAPIReturn {
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [controllingViewer, setControllingViewer] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [hostMicStream, setHostMicStream] = useState<MediaStream | null>(null);

  const roomRef = useRef<Room | null>(null);
  const startingRef = useRef(false);
  // Serialises every mutation of the screen-share publication — see publishStream.
  const publishQueueRef = useRef<Promise<void>>(Promise.resolve());
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const authTokenRef = useRef<string | null>(null);
  const hostMicStreamRef = useRef<MediaStream | null>(null);
  // Current playback gain, so a viewer who joins later starts at the level the
  // host already chose rather than snapping back to the default.
  const speakerGainRef = useRef<number>(DEFAULT_REMOTE_AUDIO_GAIN);

  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);
  const onTailnetHelloRef = useRef(onTailnetHello);
  const onViewerJoinedRef = useRef(onViewerJoined);
  const onViewerLeftRef = useRef(onViewerLeft);

  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;
  onTailnetHelloRef.current = onTailnetHello;
  onViewerJoinedRef.current = onViewerJoined;
  onViewerLeftRef.current = onViewerLeft;
  // Sessions that disallow control must never surface a request or forward an
  // input event, even if a viewer sends one anyway.
  const allowControlRef = useRef(allowControl);
  allowControlRef.current = allowControl;
  // Data messages do not wait for React renders. Keep controller ownership and
  // per-viewer sequence state in refs so an old controller cannot inject in
  // the handoff window.
  const controllingViewerRef = useRef<string | null>(null);
  const lastInputSequenceRef = useRef(new Map<string, number>());
  const lastRejectedInputLogAtRef = useRef(new Map<string, number>());

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
    if (payload.byteLength > MAX_CONTROL_MESSAGE_BYTES) return;
    const viewerId = participant.identity;

    try {
      const text = decoder.decode(payload);
      const message = JSON.parse(text) as ControlMessage | InputMessage;

      if ('type' in message) {
        switch (message.type) {
          case 'tailnet-hello':
            onTailnetHelloRef.current?.(viewerId, message.ips, message.reply);
            break;
          case 'control-request':
            if (!allowControlRef.current) {
              console.warn('[WebRTCHostSFU] Ignoring control request: session disallows control', {
                viewerId,
              });
              return;
            }
            onControlRequestRef.current?.(viewerId);
            break;
          case 'control-revoke': {
            const viewer = viewersRef.current.get(viewerId);
            if (viewer) {
              viewer.controlState = 'view-only';
              setViewers(new Map(viewersRef.current));
              setControllingViewer((prev) => (prev === viewerId ? null : prev));
              if (controllingViewerRef.current === viewerId) controllingViewerRef.current = null;
            }
            break;
          }
          case 'input':
            if (!allowControlRef.current) return;
            {
              const viewer = viewersRef.current.get(viewerId);
              const lastSequence = lastInputSequenceRef.current.get(viewerId);
              if (
                controllingViewerRef.current !== viewerId ||
                viewer?.controlState !== 'granted' ||
                !Number.isSafeInteger(message.sequence) ||
                message.sequence < 0 ||
                (lastSequence !== undefined && message.sequence <= lastSequence)
              ) {
                // Do not let a hostile sender freeze the renderer through its
                // own console output. Keep enough telemetry to diagnose a bad
                // client without logging thousands of rejected packets.
                const now = Date.now();
                const lastLoggedAt = lastRejectedInputLogAtRef.current.get(viewerId) ?? 0;
                if (now - lastLoggedAt >= REJECTED_INPUT_LOG_INTERVAL_MS) {
                  lastRejectedInputLogAtRef.current.set(viewerId, now);
                  console.warn('[WebRTCHostSFU] Dropping unauthorized or stale input', {
                    viewerId,
                    controller: controllingViewerRef.current,
                    sequence: message.sequence,
                    lastSequence: lastSequence ?? null,
                  });
                }
                return;
              }
              lastInputSequenceRef.current.set(viewerId, message.sequence);
            }
            onInputReceivedRef.current?.(viewerId, message);
            break;
        }
      }
    } catch {
      // Invalid message - ignore
    }
  }, []);

  // Add viewer from remote participant
  /**
   * Route a viewer's audio to the speakers.
   *
   * Replaces any previous element for that viewer, so it is safe to call
   * again for a track that is already playing.
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
      console.warn('[WebRTCHostSFUAPI] Failed to play viewer audio:', err);
    });

    viewer.audioElement = audioEl;
    console.log('[WebRTCHostSFUAPI] Viewer audio attached', { viewerId: viewer.id });
  }, []);

  const addViewer = useCallback(
    (participant: RemoteParticipant) => {
      if (viewersRef.current.has(participant.identity)) return;

      const viewer: ViewerConnection = {
        id: participant.identity,
        peerConnection: null as unknown as RTCPeerConnection,
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
      // (and found no viewer entry). Pick up anything already subscribed rather
      // than waiting for an event that has been and gone.
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

  // Remove viewer
  const removeViewer = useCallback((identity: string) => {
    if (!viewersRef.current.has(identity)) return;

    const viewer = viewersRef.current.get(identity);
    if (viewer?.audioElement) {
      viewer.audioElement.pause();
      viewer.audioElement.srcObject = null;
    }
    viewer?.amplifiedAudio?.dispose();

    viewersRef.current.delete(identity);
    lastInputSequenceRef.current.delete(identity);
    lastRejectedInputLogAtRef.current.delete(identity);
    setViewers(new Map(viewersRef.current));
    setControllingViewer((prev) => (prev === identity ? null : prev));
    onViewerLeftRef.current?.(identity);
  }, []);

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

  // Start hosting (sets up LiveKit room and voice -- screen sharing is optional)
  const startHosting = useCallback(async () => {
    // Re-entrancy guard. The auto-start effect re-fires startHosting whenever
    // isHosting is false — which stays false through the connect retries below.
    // Without this, overlapping startHosting calls each build their own Room and
    // connect/disconnect on top of each other (a DUPLICATE_IDENTITY /
    // CLIENT_REQUEST_LEAVE storm), leaving the screen share published on a
    // connection that then gets torn down → camera shows but presentation is
    // black. One attempt at a time; the effect retries sequentially after.
    if (startingRef.current || roomRef.current) return;
    startingRef.current = true;
    try {
      // Capture host microphone before connecting
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: VOICE_AUDIO_CONSTRAINTS,
          video: false,
        });
        markTrackAsSpeech(micStream.getAudioTracks()[0]);
        hostMicStreamRef.current = micStream;
        setHostMicStream(micStream);
        setHasMic(true);
        setMicEnabled(true);
        console.log('[WebRTCHostSFUAPI] Host microphone captured');
      } catch (err: unknown) {
        console.warn('[WebRTCHostSFUAPI] Could not access microphone:', err);
        hostMicStreamRef.current = null;
        setHostMicStream(null);
        setHasMic(false);
        setMicEnabled(false);
      }

      // Get auth token from Electron
      const api = getElectronAPI();
      const { token } = await api.invoke('auth:getToken', undefined);
      if (!token) {
        setError('Authentication required');
        return;
      }
      authTokenRef.current = token;

      // Fetch LiveKit token from PairUX API with Bearer auth
      const tokenRes = await fetch(`${API_BASE_URL}/api/livekit/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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
        data: { token: string; url: string; roomName: string; iceServers?: RTCIceServer[] };
      };

      // Create and connect room.
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        addViewer(participant);
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        removeViewer(participant.identity);
      });

      // Handle viewer audio
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;

        // Audio can be subscribed before the viewer is registered (tracks are
        // subscribed during connect(), while participants already in the room
        // are enumerated after it). Register them now instead of dropping the
        // track, which used to leave that viewer permanently silent.
        if (!viewersRef.current.has(participant.identity)) {
          console.log('[WebRTCHostSFUAPI] Audio arrived before viewer was tracked; adding viewer', {
            viewerId: participant.identity,
          });
          addViewer(participant);
        }

        const viewer = viewersRef.current.get(participant.identity);
        if (!viewer) {
          console.warn('[WebRTCHostSFUAPI] Dropping viewer audio: no viewer entry', {
            viewerId: participant.identity,
          });
          return;
        }

        attachViewerAudio(viewer, track.mediaStreamTrack);
        setViewers(new Map(viewersRef.current));
      });

      room.on(
        RoomEvent.TrackUnsubscribed,
        (track, _publication, participant: RemoteParticipant) => {
          if (track.kind !== Track.Kind.Audio) return;

          const viewer = viewersRef.current.get(participant.identity);
          if (!viewer) return;

          viewer.audioTrack = null;
          viewer.amplifiedAudio?.dispose();
          viewer.amplifiedAudio = null;
          if (viewer.audioElement) {
            viewer.audioElement.pause();
            viewer.audioElement.srcObject = null;
            viewer.audioElement = null;
          }

          setViewers(new Map(viewersRef.current));
        }
      );

      room.on(RoomEvent.DataReceived, handleDataReceived);

      // livekit-client recovers from transient ICE/consent blips on its own
      // (common on multi-homed hosts whose dead secondary NIC fails consent
      // freshness ~30s in). While it reconnects the stream keeps flowing, so do
      // NOT surface a fatal error — just clear any stale toast once recovered.
      room.on(RoomEvent.Reconnecting, () => {
        console.warn('[WebRTCHostSFUAPI] Reconnecting to SFU (transient ICE blip)...');
      });
      room.on(RoomEvent.Reconnected, () => {
        console.log('[WebRTCHostSFUAPI] Reconnected to SFU');
        setIsHosting(true);
        setError(null);
      });

      // We deliberately disconnect between connect retries below; suppress the
      // fatal "Disconnected" toast for those intentional drops.
      let connecting = true;
      room.on(RoomEvent.ConnectionStateChanged, (state: LKConnectionState) => {
        if (state === LKConnectionState.Disconnected) {
          if (connecting) return;
          // Terminal: livekit only reaches Disconnected after exhausting its
          // own reconnect attempts (transient blips emit Reconnecting instead).
          setIsHosting(false);
          setError('Disconnected from server');
          // Release the dead room so the auto-start effect can re-host cleanly
          // (the re-entrancy guard keys off roomRef).
          roomRef.current = null;
        } else if (state === LKConnectionState.Connected) {
          // Back to healthy — drop any error left over from a reconnect.
          setError(null);
        }
      });

      // Connect with retries. On a flaky multi-homed host the first ICE
      // negotiation often fails ("could not establish pc connection") while a
      // retry lands on a working candidate pair — the SFU logs show exactly
      // this (first attempt dropped, second "participant active" via udp relay).
      // rtcConfig carries the TURN relay (and, with "Force relay" on,
      // iceTransportPolicy='relay') so publishing survives the dead NIC.
      const rtcConfig = buildSfuRtcConfig(data.iceServers);
      const livekitUrl = data.url || LIVEKIT_URL;
      const maxConnectAttempts = 3;
      let connected = false;
      for (let attempt = 1; attempt <= maxConnectAttempts && !connected; attempt++) {
        try {
          await room.connect(livekitUrl, data.token, { rtcConfig });
          connected = true;
        } catch (connectErr) {
          console.warn(
            `[WebRTCHostSFUAPI] connect attempt ${String(attempt)}/${String(maxConnectAttempts)} failed:`,
            connectErr
          );
          try {
            await room.disconnect();
          } catch {
            // room may already be torn down — ignore
          }
          if (attempt >= maxConnectAttempts) throw connectErr;
          await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
        }
      }
      connecting = false;

      // Track existing participants
      for (const participant of room.remoteParticipants.values()) {
        addViewer(participant);
      }

      // Publish host mic. A transient publisher-PC hiccup here must NOT fail
      // hosting with a fatal toast — the connection is up and livekit recovers;
      // the mic is non-essential vs the screen share (published separately).
      const micStream = hostMicStreamRef.current;
      if (micStream) {
        for (const track of micStream.getAudioTracks()) {
          try {
            await room.localParticipant.publishTrack(track, {
              source: Track.Source.Microphone,
            });
          } catch (micErr) {
            console.warn('[WebRTCHostSFUAPI] mic publish hiccup (will recover):', micErr);
          }
        }
      }

      setIsHosting(true);
      setError(null);
    } catch (err) {
      console.error('[WebRTCHostSFUAPI] Failed to start hosting:', err);
      setError(err instanceof Error ? err.message : 'Failed to start hosting');
      // Tear the failed room down so the next (sequential) attempt starts clean
      // rather than bailing on the roomRef guard forever.
      try {
        await roomRef.current?.disconnect();
      } catch {
        // already gone — ignore
      }
      roomRef.current = null;
    } finally {
      startingRef.current = false;
    }
  }, [sessionId, hostId, addViewer, attachViewerAudio, removeViewer, handleDataReceived]);

  /**
   * Run `op` with exclusive access to the screen-share publication.
   *
   * Publishing is a read-then-await-then-write: `publicationFor()` decides
   * replace-vs-publish, then the very next line yields at an `await`. Two
   * overlapping callers therefore both read "nothing published yet" and both
   * call `publishTrack` — livekit logs `publishing a second track with the same
   * source: screen_share` and rejects the loser with `TrackInvalidError`. That
   * rejection drives the caller into another retry, and on macOS the retries
   * restart ScreenCaptureKit underneath the running stream, which terminates the
   * app with `Collection <__NSArrayM> was mutated while being enumerated`.
   *
   * Overlap is easy to hit: the publish effect in CapturePreview re-runs on any
   * of five dependencies, and a slow publish that ends in "publication of local
   * track timed out" stays in flight for many seconds while it does.
   *
   * Chaining onto a single promise makes each decision-and-publish atomic. The
   * queue itself must never settle rejected or every later op would be dropped,
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
   * Publish the presentation stream, replacing whatever is already published.
   *
   * Republishing is not the same as publishing. Turning the camera bubble on
   * swaps the raw screen track for a composited one and calls this again —
   * and `publishTrack` would then leave *both* tracks published. Viewers fold
   * every subscribed video track into one MediaStream and a <video> element
   * renders only the first, so the second publication is invisible: the camera
   * never arrives and the viewer watches the pre-camera screen forever.
   *
   * Replacing the track inside the existing publication keeps the same
   * publication SID, so viewers switch over without resubscribing. The P2P
   * host does exactly this, for exactly this reason — see useWebRTCHostAPI.
   *
   * Callers never run concurrently: every call is serialised by
   * `enqueuePublishOp`, and the room/publication state is read *inside* the
   * critical section so a queued call sees what the one ahead of it did.
   */
  const publishStream = useCallback(
    (stream: MediaStream, isStale?: () => boolean): Promise<void> =>
      enqueuePublishOp(async () => {
        // Re-checked here rather than at call time: by the time this reaches the
        // front of the queue the capture session may have been replaced or the
        // host may have stopped, and republishing a dead track would knock the
        // live one off the air.
        if (isStale?.()) {
          console.log('[WebRTCHostSFUAPI] Skipping stale publish (capture session changed)');
          return;
        }

        const room = roomRef.current;
        if (room?.state !== LKConnectionState.Connected) {
          console.warn('[WebRTCHostSFUAPI] Cannot publish stream: room not connected');
          return;
        }

        const publicationFor = (source: Track.Source): LocalTrackPublication | undefined =>
          Array.from(room.localParticipant.trackPublications.values()).find(
            (pub: LocalTrackPublication) => pub.source === source
          );

        for (const track of stream.getTracks()) {
          try {
            const source =
              track.kind === 'video' ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio;

            if (track.kind === 'video') {
              track.contentHint = 'detail';
            }

            const existing = publicationFor(source);
            if (existing?.track) {
              // Already publishing this exact track — a re-render, not a new source.
              if (existing.track.mediaStreamTrack.id === track.id) continue;

              await existing.track.replaceTrack(track);
              console.log('[WebRTCHostSFUAPI] Replaced published track', {
                source,
                trackId: track.id,
              });
              continue;
            }

            console.log('[WebRTCHostSFUAPI] Publishing track', { source, trackId: track.id });

            if (track.kind === 'video') {
              await room.localParticipant.publishTrack(track, {
                source: Track.Source.ScreenShare,
                simulcast: false,
                videoEncoding: {
                  maxBitrate: 8_000_000,
                  maxFramerate: 60,
                },
              });
            } else {
              await room.localParticipant.publishTrack(track, {
                source: Track.Source.ScreenShareAudio,
              });
            }
          } catch (err) {
            // Losing a publish race is not a failure: the track this call wanted
            // on the air is already on the air. Serialisation should prevent it,
            // but a livekit-internal retry can still land one, and treating it as
            // an error is what turns a duplicate into a retry loop.
            if (isAlreadyPublished(err)) {
              console.log('[WebRTCHostSFUAPI] Track already published — treating as success', {
                trackId: track.id,
              });
              continue;
            }

            // A transient ICE/consent blip can reject an in-flight publish ("publication
            // of local track timed out") even though livekit reconnects and the track
            // ends up published. Only treat it as fatal if the room is actually gone;
            // otherwise swallow it so it never bubbles up as an uncaught rejection /
            // scary "Streaming error" toast while the stream is still live. The cast
            // widens room.state back to the full enum — it mutates across the await,
            // so the narrowing from the early-return guard no longer holds here.
            if ((room.state as LKConnectionState) === LKConnectionState.Disconnected) throw err;
            console.warn('[WebRTCHostSFUAPI] publishTrack hiccup (room recovering):', err);
          }
        }
      }),
    [enqueuePublishOp]
  );

  // Unpublish screen share tracks (room stays connected, viewers stay connected)
  //
  // Shares publishStream's queue. Interleaving the two is how a stop/start
  // straddling a reconnect ends up unpublishing the track the restart just put
  // on the air, leaving viewers on a black frame with the host still "live".
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
              console.log('[WebRTCHostSFUAPI] Unpublishing track', {
                source: pub.source,
                trackId: pub.track.mediaStreamTrack.id,
              });
              await room.localParticipant.unpublishTrack(pub.track);
            }
          }
        }
      }),
    [enqueuePublishOp]
  );

  // Stop hosting
  const stopHosting = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      // Snapshot first: unpublishTrack deletes from trackPublications, and
      // deleting from a Map while forEach walks it is the same mutate-while-
      // enumerating shape that crashes the native capture side. unpublishStream
      // already snapshots; this path had been missed.
      for (const pub of Array.from(room.localParticipant.trackPublications.values())) {
        if (pub.track) {
          void room.localParticipant.unpublishTrack(pub.track);
        }
      }
      void room.disconnect();
      roomRef.current = null;
    }

    // Stop host mic tracks
    if (hostMicStreamRef.current) {
      hostMicStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      hostMicStreamRef.current = null;
    }
    setHostMicStream(null);

    viewersRef.current.forEach((viewer) => {
      if (viewer.audioElement) {
        viewer.audioElement.pause();
        viewer.audioElement.srcObject = null;
      }
      viewer.amplifiedAudio?.dispose();
    });
    viewersRef.current.clear();
    setViewers(new Map());

    setIsHosting(false);
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);

  // Republishing is handled entirely by publishStream(), which replaces the
  // track inside the existing publication.
  //
  // There used to be an effect here that swapped the published video for
  // `localStream`'s track whenever that stream or `isHosting` changed. It was
  // wrong once the camera bubble existed: `localStream` is the *raw* screen
  // capture, not the composited presentation track, so re-establishing a host
  // connection with the camera on silently replaced the composite with the
  // bare screen and dropped the bubble for every viewer.

  /** Tell a peer our tailnet addresses so it can test a direct path. */
  const sendTailnetHello = useCallback(
    (viewerId: string, ips: string[], reply: boolean) => {
      sendData(
        {
          type: 'tailnet-hello',
          participantId: hostId,
          ips,
          reply,
          timestamp: Date.now(),
        },
        viewerId
      );
    },
    [hostId, sendData]
  );

  // Grant control
  const grantControl = useCallback(
    (viewerId: string) => {
      if (!allowControlRef.current) {
        console.warn('[WebRTCHostSFU] Refusing to grant control: session disallows control', {
          viewerId,
        });
        return;
      }

      if (!viewersRef.current.has(viewerId)) return;

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

      const grantMessage: ControlMessage = {
        type: 'control-grant',
        participantId: viewerId,
        timestamp: Date.now(),
      };
      sendData(grantMessage, viewerId);

      const viewer = viewersRef.current.get(viewerId);
      if (viewer) viewer.controlState = 'granted';

      controllingViewerRef.current = viewerId;
      lastInputSequenceRef.current.delete(viewerId);
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

      if (controllingViewerRef.current === viewerId) controllingViewerRef.current = null;
      setControllingViewer((prev) => (prev === viewerId ? null : prev));
      setViewers(new Map(viewersRef.current));
    },
    [sendData]
  );

  // Kick viewer
  const kickViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (!viewer) return;

      const message: KickMessage = {
        type: 'kick',
        timestamp: Date.now(),
      };
      sendData(message, viewerId);

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

  // Mute viewer
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

  /**
   * Set playback gain for every remote participant.
   *
   * Applies to the gain stage rather than the audio elements, so it can go
   * above 1.0 — which is the whole point, since an element cannot.
   */
  const setSpeakerGain = useCallback((gain: number) => {
    speakerGainRef.current = gain;
    for (const viewer of viewersRef.current.values()) {
      viewer.amplifiedAudio?.setGain(gain);
    }
  }, []);

  return {
    isHosting,
    viewerCount: viewers.size,
    viewers,
    controllingViewer,
    sendTailnetHello,
    error,
    startHosting,
    stopHosting,
    publishStream,
    unpublishStream,
    grantControl,
    revokeControl,
    // Host microphone
    micEnabled,
    hasMic,
    toggleMic,
    hostMicStream,
    setSpeakerGain,
    kickViewer,
    muteViewer,
  };
}
