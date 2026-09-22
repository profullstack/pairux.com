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
  ControlMessage,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';
import {
  VOICE_AUDIO_CONSTRAINTS,
  VIDEO_NETWORK_PRIORITY,
  DEFAULT_REMOTE_AUDIO_GAIN,
  prioritizeAudioSender,
  tuneOpusForVoice,
  markTrackAsSpeech,
} from '@pairux/shared-types';
import { amplifyRemoteAudio, type AmplifiedAudioTrack } from '@/lib/remoteAudioGain';

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
const REJECTED_INPUT_LOG_INTERVAL_MS = 5_000;
const MAX_CONTROL_MESSAGE_BYTES = 16 * 1024;
const OFFER_RETRY_INTERVAL_MS = 10_000;
const MAX_OFFER_ATTEMPTS = 3;

// Default ICE servers (STUN only — overridden with TURN from the SSE connected event)
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface ViewerConnection {
  id: string;
  peerConnection: RTCPeerConnection;
  hostAudioSender: RTCRtpSender | null;
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

function disposeViewerAudio(viewer: ViewerConnection): void {
  if (viewer.audioElement) {
    viewer.audioElement.pause();
    viewer.audioElement.srcObject = null;
    viewer.audioElement = null;
  }
  viewer.amplifiedAudio?.dispose();
  viewer.amplifiedAudio = null;
}

interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  senderId: string;
  targetId?: string;
  negotiationId?: string;
  timestamp: number;
}

interface ViewerNegotiationState {
  makingOffer: boolean;
  applyingAnswer: boolean;
  needsNegotiation: boolean;
  currentNegotiationId: string | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

function canNegotiate(pc: RTCPeerConnection, state: ViewerNegotiationState): boolean {
  return pc.signalingState === 'stable' && !state.applyingAnswer;
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
  /** A peer reporting its tailnet addresses (diagnostic only). */
  onTailnetHello?: (viewerId: string, ips: string[], isReply: boolean) => void;
}

interface UseWebRTCHostAPIReturn {
  isHosting: boolean;
  viewerCount: number;
  viewers: Map<string, ViewerConnection>;
  controllingViewer: string | null;
  error: string | null;
  startHosting: () => Promise<void>;
  stopHosting: () => void;
  publishStream: (stream: MediaStream, isSuperseded?: () => boolean) => Promise<void>;
  unpublishStream: () => Promise<void>;
  grantControl: (viewerId: string) => void;
  revokeControl: (viewerId: string) => void;
  kickViewer: (viewerId: string) => void;
  muteViewer: (viewerId: string, muted: boolean) => void;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
  /** The host's dedicated microphone stream — alive whenever hosting, independent of screen sharing. */
  hostMicStream: MediaStream | null;
  /** Playback gain for remote participants. Can exceed 1.0. */
  setSpeakerGain: (gain: number) => void;
  sendTailnetHello: (viewerId: string, ips: string[], reply: boolean) => void;
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
  onTailnetHello,
}: UseWebRTCHostAPIOptions): UseWebRTCHostAPIReturn {
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [controllingViewer, setControllingViewer] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [hostMicStream, setHostMicStream] = useState<MediaStream | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const removeViewerRef = useRef<((viewerId: string) => void) | undefined>(undefined);
  const relayedAudioSendersRef = useRef(new Map<string, Map<string, RTCRtpSender>>());
  const mutedViewerIdsRef = useRef(new Set<string>());
  const publishedStreamVersionRef = useRef(0);
  const mediaQueueRef = useRef<Promise<void>>(Promise.resolve());
  const authTokenRef = useRef<string | null>(null);
  const isStartingRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const isPublishedStreamSupersededRef = useRef<() => boolean>(() => false);
  const hostMicStreamRef = useRef<MediaStream | null>(null);
  // Current playback gain, so a viewer who joins later starts at the level the
  // host already chose rather than snapping back to the default.
  const speakerGainRef = useRef<number>(DEFAULT_REMOTE_AUDIO_GAIN);

  // ICE servers received from the SSE connected event (includes TURN)
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  // Buffer ICE candidates per viewer until their remote description is set
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const negotiationStatesRef = useRef(new Map<string, ViewerNegotiationState>());
  const negotiationSequenceRef = useRef(0);
  const negotiationInstanceRef = useRef<string | null>(null);

  // Keep refs updated
  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);
  const onTailnetHelloRef = useRef(onTailnetHello);
  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;
  onTailnetHelloRef.current = onTailnetHello;
  // Sessions that disallow control must never surface a request or forward an
  // input event, even if a viewer sends one anyway.
  const allowControlRef = useRef(allowControl);
  allowControlRef.current = allowControl;
  // Never use React state alone to authorize OS input: a data-channel message
  // can arrive between a grant/revoke and the next render. These refs are the
  // synchronous authority for this transport.
  const controllingViewerRef = useRef<string | null>(null);
  const lastInputSequenceRef = useRef(new Map<string, number>());
  const lastRejectedInputLogAtRef = useRef(new Map<string, number>());

  const getPreferredHostAudioTrack = useCallback(
    (streamOverride?: MediaStream | null): MediaStreamTrack | null => {
      const stream = streamOverride === undefined ? localStreamRef.current : streamOverride;
      const streamAudioTrack = stream?.getAudioTracks()[0] ?? null;
      if (streamAudioTrack) return streamAudioTrack;
      return hostMicStreamRef.current?.getAudioTracks()[0] ?? null;
    },
    []
  );

  const syncHostAudioSender = useCallback(
    async (viewer: ViewerConnection, preferredTrack: MediaStreamTrack | null) => {
      const pc = viewer.peerConnection;

      if (preferredTrack) {
        if (viewer.hostAudioSender) {
          if (viewer.hostAudioSender.track !== preferredTrack) {
            await viewer.hostAudioSender.replaceTrack(preferredTrack);
          }
        } else {
          viewer.hostAudioSender = pc.addTrack(preferredTrack, new MediaStream([preferredTrack]));
          await prioritizeAudioSender(viewer.hostAudioSender);
        }
      } else if (viewer.hostAudioSender) {
        pc.removeTrack(viewer.hostAudioSender);
        viewer.hostAudioSender = null;
      }
    },
    []
  );

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
          signal: AbortSignal.timeout(OFFER_RETRY_INTERVAL_MS),
        });

        if (!response.ok) {
          console.error('[WebRTCHost] Failed to send signal:', await response.text());
        }
        return response.ok;
      } catch (err) {
        console.error('[WebRTCHost] Error sending signal:', err);
        return false;
      }
    },
    [sessionId]
  );

  // Coalesce track changes per peer until its outstanding offer is answered.
  const requestViewerNegotiation = useCallback(
    async function negotiate(viewerId: string, pc: RTCPeerConnection): Promise<void> {
      if (viewersRef.current.get(viewerId)?.peerConnection !== pc) return;
      let state = negotiationStatesRef.current.get(viewerId);
      if (!state) {
        state = {
          makingOffer: false,
          applyingAnswer: false,
          needsNegotiation: false,
          currentNegotiationId: null,
          retryTimer: null,
        };
        negotiationStatesRef.current.set(viewerId, state);
      }
      const current = () =>
        viewersRef.current.get(viewerId)?.peerConnection === pc &&
        negotiationStatesRef.current.get(viewerId) === state;
      state.needsNegotiation = true;
      if (state.makingOffer || !canNegotiate(pc, state)) return;
      state.makingOffer = true;
      state.needsNegotiation = false;
      let offered = false;
      try {
        const offer = await pc.createOffer();
        if (!current()) return;
        if (!canNegotiate(pc, state)) {
          state.needsNegotiation = true;
          return;
        }
        if (!offer.sdp) throw new Error('Peer connection produced an empty offer');
        offer.sdp = tuneOpusForVoice(offer.sdp);
        await pc.setLocalDescription(offer);
        if (!current()) return;

        negotiationInstanceRef.current ??= crypto.randomUUID();
        const negotiationId = `${negotiationInstanceRef.current}:${hostId}:${viewerId}:${String(++negotiationSequenceRef.current)}`;
        state.currentNegotiationId = negotiationId;
        const signal: SignalMessage = {
          type: 'offer',
          sdp: offer.sdp,
          senderId: hostId,
          targetId: viewerId,
          negotiationId,
          timestamp: Date.now(),
        };
        const pending = () => current() && state.currentNegotiationId === negotiationId;
        let attempts = 0;
        // Retry the SAME SDP, not a replacement offer: old clients without
        // negotiation IDs can safely answer it after a missed SSE message.
        const transmit = async (): Promise<void> => {
          if (!pending()) return;
          attempts += 1;
          // Include gathered ICE on retries: the original trickle events may
          // have been lost alongside the first offer during an SSE outage.
          await sendSignal({ ...signal, sdp: pc.localDescription?.sdp ?? signal.sdp });
          if (!pending()) return;
          const checkAnswer = () => {
            state.retryTimer = null;
            if (!pending()) return;
            if (state.applyingAnswer) {
              state.retryTimer = setTimeout(checkAnswer, OFFER_RETRY_INTERVAL_MS);
              return;
            }
            if (attempts >= MAX_OFFER_ATTEMPTS) {
              if (pc.connectionState === 'connected') {
                setError(
                  'Participant media is still connected, but changes could not be synchronized. Ask them to rejoin if changes remain missing.'
                );
                return;
              }
              setError('A participant connection timed out. Ask them to leave and rejoin.');
              removeViewerRef.current?.(viewerId);
              return;
            }
            void transmit();
          };
          state.retryTimer = setTimeout(checkAnswer, OFFER_RETRY_INTERVAL_MS);
        };
        offered = true;
        await transmit();
      } catch (err) {
        state.needsNegotiation = true;
        throw err;
      } finally {
        state.makingOffer = false;
        // The SSE answer can arrive before the offer's HTTP request finishes.
        if (offered && current() && state.needsNegotiation && canNegotiate(pc, state)) {
          void negotiate(viewerId, pc).catch((err: unknown) => {
            console.error('[WebRTCHost] Failed to negotiate queued changes:', err);
          });
        }
      }
    },
    [hostId, sendSignal]
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
        let framesEncoded: number | undefined;
        let videoSenderStatsCount = 0;

        stats.forEach((report: RTCStatsReport[keyof RTCStatsReport] & Record<string, unknown>) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            videoSenderStatsCount += 1;
            bytesSent += (report.bytesSent as number | undefined) ?? 0;
            packetsSent += (report.packetsSent as number | undefined) ?? 0;
            frameRate = report.framesPerSecond as number | undefined;
            frameWidth = report.frameWidth as number | undefined;
            frameHeight = report.frameHeight as number | undefined;
            framesEncoded = report.framesEncoded as number | undefined;
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

        if (videoSenderStatsCount > 0) {
          console.log('[WebRTCHost] Video outbound stats', {
            viewerId: viewer.id,
            connectionState: viewer.connectionState,
            bytesSent,
            packetsSent,
            framesEncoded: framesEncoded ?? null,
            frameRate: frameRate ?? null,
            frameWidth: frameWidth ?? null,
            frameHeight: frameHeight ?? null,
            roundTripTimeMs: roundTripTime ?? null,
          });
        } else {
          console.warn('[WebRTCHost] No outbound video stats for viewer', {
            viewerId: viewer.id,
            connectionState: viewer.connectionState,
          });
        }

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
    if (typeof event.data !== 'string' || event.data.length > MAX_CONTROL_MESSAGE_BYTES) return;
    try {
      const message = JSON.parse(event.data) as ControlMessage | InputMessage;

      if ('type' in message) {
        switch (message.type) {
          case 'tailnet-hello':
            onTailnetHelloRef.current?.(viewerId, message.ips, message.reply);
            break;
          case 'control-request':
            if (!allowControlRef.current) {
              console.warn('[WebRTCHost] Ignoring control request: session disallows control', {
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
                // Logging every rejected packet can itself make the renderer
                // unresponsive when a peer floods this data channel.
                const now = Date.now();
                const lastLoggedAt = lastRejectedInputLogAtRef.current.get(viewerId) ?? 0;
                if (now - lastLoggedAt >= REJECTED_INPUT_LOG_INTERVAL_MS) {
                  lastRejectedInputLogAtRef.current.set(viewerId, now);
                  console.warn('[WebRTCHost] Dropping unauthorized or stale input', {
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
      // Invalid message
    }
  }, []);

  // Relay a viewer's audio track to all other connected viewers via renegotiation
  const relayAudioToOtherViewers = useCallback(
    async (sourceViewerId: string, audioTrack: MediaStreamTrack) => {
      const audioStream = new MediaStream([audioTrack]);

      for (const [otherId, otherViewer] of Array.from(viewersRef.current.entries())) {
        if (viewersRef.current.get(sourceViewerId)?.audioTrack !== audioTrack) return;
        if (viewersRef.current.get(otherId) !== otherViewer) continue;
        if (otherId === sourceViewerId) continue;
        if (
          otherViewer.connectionState !== 'connected' &&
          otherViewer.connectionState !== 'connecting' &&
          otherViewer.connectionState !== 'reconnecting'
        )
          continue;

        try {
          let senders = relayedAudioSendersRef.current.get(otherId);
          if (!senders) {
            senders = new Map();
            relayedAudioSendersRef.current.set(otherId, senders);
          }
          const previous = senders.get(sourceViewerId);
          if (previous?.track === audioTrack) continue;
          if (previous) {
            otherViewer.peerConnection.removeTrack(previous);
            senders.delete(sourceViewerId);
          }
          const relaySender = otherViewer.peerConnection.addTrack(audioTrack, audioStream);
          senders.set(sourceViewerId, relaySender);
          void prioritizeAudioSender(relaySender);
          console.log(`[WebRTCHost] Added ${sourceViewerId}'s audio to ${otherId}, renegotiating`);

          await requestViewerNegotiation(otherId, otherViewer.peerConnection);
        } catch (err) {
          console.error(`[WebRTCHost] Failed to relay audio to ${otherId}:`, err);
        }
      }
    },
    [requestViewerNegotiation]
  );

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    (viewerId: string): { pc: RTCPeerConnection; hostAudioSender: RTCRtpSender | null } => {
      console.log('[WebRTCHost] Creating peer connection for viewer:', viewerId);

      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceCandidatePoolSize: 10,
      });
      const relayedSenders = new Map<string, RTCRtpSender>();
      relayedAudioSendersRef.current.set(viewerId, relayedSenders);

      // Add local stream tracks (if currently sharing)
      const currentStream = isPublishedStreamSupersededRef.current()
        ? null
        : localStreamRef.current;
      if (currentStream) {
        // Screen-share publishing only uses video tracks here; host mic is handled separately.
        currentStream.getVideoTracks().forEach((track) => {
          track.contentHint = 'detail';
          const sender = pc.addTrack(track, currentStream);

          const params = sender.getParameters();
          const preset = BITRATE_PRESETS.excellent;
          const encoding = params.encodings[0];
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (encoding !== undefined) {
            encoding.maxBitrate = preset.maxBitrate;
            encoding.maxFramerate = preset.maxFramerate;
            // Screen video deliberately ranks BELOW audio. It can shed
            // resolution or framerate and stay useful; voice cannot shed
            // anything without going choppy, so audio gets the pipe first.
            encoding.networkPriority = VIDEO_NETWORK_PRIORITY;
          }
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          void sender.setParameters(params).catch(() => {});
        });
      }

      // Add existing viewers' audio tracks to this new viewer's PC
      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        if (otherId === viewerId) continue;
        if (otherViewer.audioTrack) {
          const audioStream = new MediaStream([otherViewer.audioTrack]);
          const sender = pc.addTrack(otherViewer.audioTrack, audioStream);
          relayedSenders.set(otherId, sender);
          void prioritizeAudioSender(sender);
        }
      }

      // Add host mic track so the viewer can hear the host
      let hostAudioSender: RTCRtpSender | null = null;
      const preferredHostAudioTrack = getPreferredHostAudioTrack(currentStream);
      if (preferredHostAudioTrack) {
        hostAudioSender = pc.addTrack(
          preferredHostAudioTrack,
          new MediaStream([preferredHostAudioTrack])
        );
        void prioritizeAudioSender(hostAudioSender);
      }

      // Handle incoming tracks from viewer (their mic audio)
      pc.ontrack = (event) => {
        if (viewersRef.current.get(viewerId)?.peerConnection !== pc) return;
        if (event.track.kind === 'audio') {
          console.log(`[WebRTCHost] Received audio track from viewer: ${viewerId}`);
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            if (viewer.audioTrack !== event.track) {
              disposeViewerAudio(viewer);
            }
            viewer.audioTrack = event.track;
            event.track.enabled = !viewer.isMuted;

            // Play viewer audio locally so the host can hear participants.
            // The element's own volume tops out at 1.0, so the track goes
            // through a gain stage first — that is the only way to make a
            // quiet talker louder rather than merely un-muted.
            try {
              if (!viewer.amplifiedAudio || !viewer.audioElement) {
                const amplified = amplifyRemoteAudio(event.track, speakerGainRef.current);
                viewer.amplifiedAudio = amplified;

                const audioEl = new Audio();
                audioEl.srcObject = amplified.stream;
                audioEl.autoplay = true;
                audioEl.volume = 1.0;
                audioEl.muted = viewer.isMuted;
                void audioEl.play().catch((err: unknown) => {
                  console.warn('[WebRTCHost] Failed to play viewer audio:', err);
                });
                viewer.audioElement = audioEl;
              }
            } catch (err) {
              disposeViewerAudio(viewer);
              console.warn('[WebRTCHost] Local playback unavailable:', err);
            }

            setViewers(new Map(viewersRef.current));

            // Relay this viewer's audio to all other viewers
            void relayAudioToOtherViewers(viewerId, event.track);
          }
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (viewersRef.current.get(viewerId)?.peerConnection !== pc) return;
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
        if (viewer?.peerConnection === pc) {
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
      };

      // Always create data channel for control and mute commands
      const dc = pc.createDataChannel('control', { ordered: true });

      dc.onopen = () => {
        const viewer = viewersRef.current.get(viewerId);
        if (viewer?.peerConnection === pc) {
          viewer.dataChannel = dc;
          if (viewer.isMuted) {
            dc.send(
              JSON.stringify({
                type: 'mute',
                participantId: viewerId,
                muted: true,
                timestamp: Date.now(),
              } satisfies MuteMessage)
            );
          }
          setViewers(new Map(viewersRef.current));
        }
      };

      dc.onclose = () => {
        const viewer = viewersRef.current.get(viewerId);
        if (viewer?.peerConnection === pc && viewer.dataChannel === dc) {
          viewer.dataChannel = null;
          viewer.controlState = 'view-only';
          setViewers(new Map(viewersRef.current));
          setControllingViewer((prev) => (prev === viewerId ? null : prev));
        }
      };

      dc.onmessage = (event: MessageEvent<string>) => {
        if (
          viewersRef.current.get(viewerId)?.peerConnection !== pc ||
          viewersRef.current.get(viewerId)?.dataChannel !== dc
        )
          return;
        handleDataChannelMessage(viewerId, event);
      };

      return { pc, hostAudioSender };
    },
    [
      getPreferredHostAudioTrack,
      hostId,
      handleDataChannelMessage,
      sendSignal,
      relayAudioToOtherViewers,
    ]
  );

  // Remove a viewer
  const removeViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer) {
        // Invalidate callbacks before close() emits any further peer events.
        viewersRef.current.delete(viewerId);
        relayedAudioSendersRef.current.delete(viewerId);
        for (const [destinationId, destination] of viewersRef.current) {
          const senders = relayedAudioSendersRef.current.get(destinationId);
          const sender = senders?.get(viewerId);
          if (!sender) continue;
          senders?.delete(viewerId);
          try {
            destination.peerConnection.removeTrack(sender);
            void requestViewerNegotiation(destinationId, destination.peerConnection).catch(
              (err: unknown) => {
                console.warn('[WebRTCHost] Failed to negotiate departed audio:', err);
              }
            );
          } catch (err) {
            console.warn('[WebRTCHost] Failed to detach departed audio:', err);
          }
        }
        const negotiation = negotiationStatesRef.current.get(viewerId);
        if (negotiation?.retryTimer) clearTimeout(negotiation.retryTimer);
        negotiationStatesRef.current.delete(viewerId);
        console.log('[WebRTCHost] Removing viewer:', viewerId);
        // Clean up audio element
        disposeViewerAudio(viewer);
        viewer.peerConnection.close();
        pendingCandidatesRef.current.delete(viewerId);
        lastInputSequenceRef.current.delete(viewerId);
        lastRejectedInputLogAtRef.current.delete(viewerId);
        if (controllingViewerRef.current === viewerId) controllingViewerRef.current = null;
        setControllingViewer((previous) => (previous === viewerId ? null : previous));
        setViewers(new Map(viewersRef.current));
        onViewerLeft?.(viewerId);
      }
    },
    [onViewerLeft, requestViewerNegotiation]
  );

  removeViewerRef.current = removeViewer;

  // Handle viewer joining
  const handleViewerJoin = useCallback(
    async (viewerId: string) => {
      if (viewerId === hostId) return;
      if (viewersRef.current.has(viewerId)) return;

      console.log('[WebRTCHost] Viewer joining:', viewerId);

      const { pc, hostAudioSender } = createPeerConnection(viewerId);

      const viewer: ViewerConnection = {
        id: viewerId,
        peerConnection: pc,
        hostAudioSender,
        dataChannel: null,
        connectionState: 'connecting',
        controlState: 'view-only',
        networkQuality: 'good',
        currentPreset: 'good',
        audioTrack: null,
        audioElement: null,
        amplifiedAudio: null,
        isMuted: mutedViewerIdsRef.current.has(viewerId),
      };

      viewersRef.current.set(viewerId, viewer);
      setViewers(new Map(viewersRef.current));
      onViewerJoined?.(viewerId);

      // Create and send offer
      try {
        await requestViewerNegotiation(viewerId, pc);
      } catch (err) {
        console.error('[WebRTCHost] Failed to create offer:', err);
        if (viewersRef.current.get(viewerId)?.peerConnection === pc) removeViewer(viewerId);
      }
    },
    [hostId, createPeerConnection, onViewerJoined, removeViewer, requestViewerNegotiation]
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
            const pc = viewer.peerConnection;
            const state = negotiationStatesRef.current.get(viewerId);
            // Only set remote description if we're expecting an answer
            if (pc.signalingState !== 'have-local-offer') {
              console.warn(
                `[WebRTCHost] Ignoring answer from ${viewerId} — signaling state is ${viewer.peerConnection.signalingState}`
              );
              break;
            }
            if (
              !state?.currentNegotiationId ||
              state.applyingAnswer ||
              (signal.negotiationId && signal.negotiationId !== state.currentNegotiationId)
            )
              break;
            console.log('[WebRTCHost] Received answer from:', viewerId);
            const current = () =>
              viewersRef.current.get(viewerId)?.peerConnection === pc &&
              negotiationStatesRef.current.get(viewerId) === state;
            state.applyingAnswer = true;
            try {
              await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
              if (!current()) return;
              state.currentNegotiationId = null;
              if (state.retryTimer) clearTimeout(state.retryTimer);
              state.retryTimer = null;
              const pending = pendingCandidatesRef.current.get(viewerId) ?? [];
              pendingCandidatesRef.current.delete(viewerId);
              for (const candidate of pending) {
                if (!current()) return;
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  console.warn('[WebRTCHost] Ignoring invalid buffered ICE:', err);
                }
              }
            } finally {
              state.applyingAnswer = false;
            }
            if (current() && state.needsNegotiation) await requestViewerNegotiation(viewerId, pc);
          }
          break;
        }

        case 'ice-candidate': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && signal.candidate?.candidate) {
            // Buffer if remote description not yet set
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
    [hostId, requestViewerNegotiation]
  );

  // Start hosting (sets up SSE signaling -- screen sharing is optional)
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

  const startHosting = useCallback(async () => {
    // Prevent concurrent startHosting calls
    if (isStartingRef.current || eventSourceRef.current) {
      return;
    }
    isStartingRef.current = true;

    console.log('[WebRTCHost] Starting hosting for session:', sessionId);

    // Get auth token for API authentication
    try {
      const api = getElectronAPI();
      const { token } = await api.invoke('auth:getToken', undefined);
      authTokenRef.current = token;
      console.log('[WebRTCHost] Auth token retrieved:', token ? 'yes' : 'no');
    } catch (err) {
      console.error('[WebRTCHost] Failed to get auth token:', err);
      isStartingRef.current = false;
      setError('Failed to authenticate. Please log in again.');
      return;
    }

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
    } catch {
      console.warn('[WebRTCHost] No microphone available — continuing without host mic');
      setHostMicStream(null);
      setHasMic(false);
      setMicEnabled(false);
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
      if (eventSourceRef.current !== eventSource) return;
      console.log('[WebRTCHost] SSE connected:', event.data);
      isStartingRef.current = false;
      setIsHosting(true);
      setError(null);

      // Use ICE servers from the server (includes TURN) if provided
      try {
        const data = JSON.parse(event.data as string) as {
          iceServers?: RTCIceServer[];
        };
        if (data.iceServers && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers;
          console.log('[WebRTCHost] Received ICE servers from server:', data.iceServers.length);
        }
      } catch {
        // Use default ICE servers
      }
    });

    eventSource.addEventListener('signal', (event) => {
      if (eventSourceRef.current !== eventSource) return;
      try {
        const signal = JSON.parse(event.data as string) as SignalMessage;
        void handleSignalMessage(signal).catch((err: unknown) => {
          console.error('[WebRTCHost] Failed to apply signal:', err);
        });
      } catch (err) {
        console.error('[WebRTCHost] Failed to parse signal:', err);
      }
    });

    eventSource.addEventListener('presence-join', (event) => {
      if (eventSourceRef.current !== eventSource) return;
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
      if (eventSourceRef.current !== eventSource) return;
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
      if (eventSourceRef.current !== eventSource) return;
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

    const previousViewers = Array.from(viewersRef.current.values());
    publishedStreamVersionRef.current++;
    localStreamRef.current = null;
    mediaQueueRef.current = Promise.resolve();
    relayedAudioSendersRef.current.clear();
    mutedViewerIdsRef.current.clear();
    viewersRef.current.clear();
    negotiationStatesRef.current.forEach((state) => {
      if (state.retryTimer) clearTimeout(state.retryTimer);
    });
    negotiationStatesRef.current.clear();
    pendingCandidatesRef.current.clear();
    lastInputSequenceRef.current.clear();
    lastRejectedInputLogAtRef.current.clear();
    controllingViewerRef.current = null;
    setControllingViewer(null);
    previousViewers.forEach((viewer) => {
      disposeViewerAudio(viewer);
      viewer.peerConnection.close();
    });
    setViewers(new Map());
    setIsHosting(false);

    // Clean up host mic
    if (hostMicStreamRef.current) {
      hostMicStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      hostMicStreamRef.current = null;
    }
    setHostMicStream(null);
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  // Publish a screen share stream to all connected viewers
  const publishStream = useCallback(
    async (stream: MediaStream, isSuperseded: () => boolean = () => false) => {
      if (isSuperseded()) return;
      const version = ++publishedStreamVersionRef.current;
      localStreamRef.current = stream;
      isPublishedStreamSupersededRef.current = isSuperseded;
      const current = () =>
        version === publishedStreamVersionRef.current &&
        localStreamRef.current === stream &&
        !isSuperseded();
      const publish = async () => {
        if (!current()) return;
        const videoTracks = stream.getVideoTracks();
        const preferredHostAudioTrack = getPreferredHostAudioTrack(stream);
        console.log('[WebRTCHost] Publishing stream:', {
          videoTracks: videoTracks.length,
          audioTracks: stream.getAudioTracks().length,
        });
        for (const track of videoTracks) {
          console.log('[WebRTCHost] Publish video track', {
            id: track.id,
            label: track.label,
            muted: track.muted,
            readyState: track.readyState,
            settings: track.getSettings(),
          });
          track.onmute = () => {
            console.warn('[WebRTCHost] Video track muted', {
              id: track.id,
              readyState: track.readyState,
            });
          };
          track.onunmute = () => {
            console.log('[WebRTCHost] Video track unmuted', {
              id: track.id,
              readyState: track.readyState,
            });
          };
          track.onended = () => {
            console.warn('[WebRTCHost] Video track ended', { id: track.id });
          };
        }

        for (const viewer of Array.from(viewersRef.current.values())) {
          if (!current()) return;
          if (viewersRef.current.get(viewer.id) !== viewer) continue;
          if (
            viewer.connectionState !== 'connected' &&
            viewer.connectionState !== 'connecting' &&
            viewer.connectionState !== 'reconnecting'
          )
            continue;

          try {
            const pc = viewer.peerConnection;
            await syncHostAudioSender(viewer, preferredHostAudioTrack);
            if (!current()) return;
            if (viewersRef.current.get(viewer.id) !== viewer) continue;
            const existingVideoSenders = pc
              .getSenders()
              .filter((sender) => sender.track?.kind === 'video');

            // Replace existing video sender(s) instead of adding duplicate transceivers on every republish.
            for (const [index, track] of videoTracks.entries()) {
              track.contentHint = 'detail';
              const existingSender = existingVideoSenders.at(index);
              if (existingSender) {
                await existingSender.replaceTrack(track);
                if (!current()) return;
                if (viewersRef.current.get(viewer.id) !== viewer) break;
              } else {
                pc.addTrack(track, stream);
              }
            }

            if (viewersRef.current.get(viewer.id) !== viewer) continue;
            // Remove any stale video senders if the new stream has fewer video tracks.
            for (const staleSender of existingVideoSenders.slice(videoTracks.length)) {
              pc.removeTrack(staleSender);
            }

            void requestViewerNegotiation(viewer.id, pc).catch((err: unknown) => {
              console.warn('[WebRTCHost] Failed to negotiate publication:', err);
            });
          } catch (err) {
            console.error(`[WebRTCHost] Failed to publish stream to ${viewer.id}:`, err);
          }
        }
      };
      // Serialize sender mutations, not HTTP signaling. An in-flight replaceTrack
      // cannot be cancelled; the next operation must run after it settles.
      const pending = mediaQueueRef.current.then(publish);
      mediaQueueRef.current = pending.catch(() => undefined);
      await pending;
    },
    [getPreferredHostAudioTrack, requestViewerNegotiation, syncHostAudioSender]
  );

  // Unpublish the screen share stream (remove video tracks) without closing connections
  const unpublishStream = useCallback(async () => {
    const version = ++publishedStreamVersionRef.current;
    localStreamRef.current = null;
    const unpublish = async () => {
      for (const viewer of Array.from(viewersRef.current.values())) {
        if (version !== publishedStreamVersionRef.current) return;
        if (viewersRef.current.get(viewer.id) !== viewer) continue;
        if (
          viewer.connectionState !== 'connected' &&
          viewer.connectionState !== 'connecting' &&
          viewer.connectionState !== 'reconnecting'
        )
          continue;

        try {
          // Remove video senders (keep audio path active)
          const senders = viewer.peerConnection.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === 'video') {
              viewer.peerConnection.removeTrack(sender);
            }
          }

          await syncHostAudioSender(viewer, getPreferredHostAudioTrack(null));
          if (version !== publishedStreamVersionRef.current) return;
          if (viewersRef.current.get(viewer.id) !== viewer) continue;
          void requestViewerNegotiation(viewer.id, viewer.peerConnection).catch((err: unknown) => {
            console.warn('[WebRTCHost] Failed to negotiate unpublication:', err);
          });
        } catch (err) {
          console.error(`[WebRTCHost] Failed to unpublish stream from ${viewer.id}:`, err);
        }
      }
    };
    const pending = mediaQueueRef.current.then(unpublish);
    mediaQueueRef.current = pending.catch(() => undefined);
    await pending;
  }, [getPreferredHostAudioTrack, requestViewerNegotiation, syncHostAudioSender]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);

  // After initialization, only publish/unpublish may change the shared stream.
  // The prop is raw capture; the published stream may contain a camera composite.

  // Grant control
  const grantControl = useCallback(
    (viewerId: string) => {
      if (!allowControlRef.current) {
        console.warn('[WebRTCHost] Refusing to grant control: session disallows control', {
          viewerId,
        });
        return;
      }

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
      controllingViewerRef.current = viewerId;
      lastInputSequenceRef.current.delete(viewerId);
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
    if (controllingViewerRef.current === viewerId) controllingViewerRef.current = null;
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

      removeViewer(viewerId);
    },
    [removeViewer]
  );

  // Mute/unmute a viewer
  const muteViewer = useCallback((viewerId: string, muted: boolean) => {
    const viewer = viewersRef.current.get(viewerId);
    if (!viewer) return;
    if (muted) mutedViewerIdsRef.current.add(viewerId);
    else mutedViewerIdsRef.current.delete(viewerId);
    if (viewer.audioTrack) viewer.audioTrack.enabled = !muted;

    // Send mute command via data channel
    if (viewer.dataChannel?.readyState === 'open') {
      const message: MuteMessage = {
        type: 'mute',
        participantId: viewerId,
        muted,
        timestamp: Date.now(),
      };
      viewer.dataChannel.send(JSON.stringify(message));
    }

    // Mute local audio playback for host
    if (viewer.audioElement) {
      viewer.audioElement.muted = muted;
    }

    viewer.isMuted = muted;
    setViewers(new Map(viewersRef.current));
  }, []);

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

  /** Tell a peer our tailnet addresses so it can test a direct path. */
  const sendTailnetHello = useCallback(
    (viewerId: string, ips: string[], reply: boolean) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer?.dataChannel?.readyState !== 'open') return;

      viewer.dataChannel.send(
        JSON.stringify({
          type: 'tailnet-hello',
          participantId: hostId,
          ips,
          reply,
          timestamp: Date.now(),
        })
      );
    },
    [hostId]
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
    hostMicStream,
    setSpeakerGain,
    sendTailnetHello,
  };
}
