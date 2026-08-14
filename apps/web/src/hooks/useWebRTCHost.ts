import { useState, useEffect, useRef, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type {
  ConnectionState,
  SignalMessage,
  InputMessage,
  ControlMessage,
  ControlStateUI,
  NetworkQuality,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';
import {
  VOICE_AUDIO_CONSTRAINTS,
  VIDEO_NETWORK_PRIORITY,
  prioritizeAudioSender,
  tuneOpusForVoice,
  markTrackAsSpeech,
  DEFAULT_REMOTE_AUDIO_GAIN,
} from '@pairux/shared-types';
import { amplifyRemoteAudio, type AmplifiedAudioTrack } from '@/lib/remoteAudioGain';

// Adaptive bitrate encoding presets (optimized for screen sharing with text)
interface BitratePreset {
  maxBitrate: number; // bps
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

const BITRATE_PRESETS: Record<NetworkQuality, BitratePreset> = {
  excellent: {
    maxBitrate: 8_000_000, // 8 Mbps - crisp text at high resolutions
    scaleResolutionDownBy: 1,
    maxFramerate: 60,
  },
  good: {
    maxBitrate: 4_000_000, // 4 Mbps - good 1080p quality
    scaleResolutionDownBy: 1,
    maxFramerate: 30,
  },
  poor: {
    maxBitrate: 1_500_000, // 1.5 Mbps
    scaleResolutionDownBy: 1.5,
    maxFramerate: 24,
  },
  bad: {
    maxBitrate: 600_000, // 600 Kbps
    scaleResolutionDownBy: 2,
    maxFramerate: 15,
  },
};

// Stats collection interval (ms)
const STATS_INTERVAL = 2000;

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

export interface ViewerConnection {
  id: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  connectionState: ConnectionState;
  controlState: ControlStateUI;
  networkQuality: NetworkQuality;
  currentPreset: NetworkQuality;
  audioTrack: MediaStreamTrack | null;
  audioElement: HTMLAudioElement | null;
  /** Gain stage feeding {@link audioElement}, so playback can exceed unity. */
  amplifiedAudio: AmplifiedAudioTrack | null;
  isMuted: boolean;
}

interface UseWebRTCHostOptions {
  sessionId: string;
  hostId: string;
  localStream: MediaStream | null;
  allowControl?: boolean;
  onViewerJoined?: (viewerId: string) => void;
  onViewerLeft?: (viewerId: string) => void;
  onControlRequest?: (viewerId: string) => void;
  onInputReceived?: (viewerId: string, input: InputMessage) => void;
}

interface UseWebRTCHostReturn {
  isHosting: boolean;
  viewerCount: number;
  viewers: Map<string, ViewerConnection>;
  controllingViewer: string | null;
  error: string | null;
  startHosting: () => Promise<void>;
  stopHosting: () => void;
  publishStream: (stream: MediaStream) => Promise<void>;
  unpublishStream: () => Promise<void>;
  grantControl: (viewerId: string) => void;
  revokeControl: (viewerId: string) => void;
  kickViewer: (viewerId: string) => void;
  muteViewer: (viewerId: string, muted: boolean) => void;
  // Host microphone
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
  micStream: MediaStream | null;
}

interface ViewerNegotiationState {
  /** A sender/transceiver changed while this viewer could not accept a new offer yet. */
  needsNegotiation: boolean;
  /** Guards the async createOffer/setLocalDescription window. */
  makingOffer: boolean;
  /** Prevents ontrack/addTrack work during setRemoteDescription(answer) from racing a new offer. */
  applyingAnswer: boolean;
  /** Connection generation for this viewer ID; increments after leave/rejoin. */
  generation: number;
  /** Correlates the outstanding answer with the exact offer that created it. */
  currentNegotiationId: string | null;
}

function canCreateOffer(peerConnection: RTCPeerConnection): boolean {
  return peerConnection.signalingState === 'stable';
}

function disposeViewerAudioPlayback(viewer: ViewerConnection): void {
  if (viewer.audioElement) {
    viewer.audioElement.pause();
    viewer.audioElement.srcObject = null;
    viewer.audioElement = null;
  }
  viewer.amplifiedAudio?.dispose();
  viewer.amplifiedAudio = null;
}

export function useWebRTCHost({
  sessionId,
  hostId,
  localStream,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
}: UseWebRTCHostOptions): UseWebRTCHostReturn {
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [controllingViewer, setControllingViewer] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const removeViewerRef = useRef<((viewerId: string) => void) | undefined>(undefined);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hostMicStreamRef = useRef<MediaStream | null>(null);
  // Current playback gain, so a viewer who joins later starts at the level the
  // host already chose rather than snapping back to the default.
  const speakerGainRef = useRef<number>(DEFAULT_REMOTE_AUDIO_GAIN);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  // Buffer ICE candidates per viewer until their remote description is set
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // A peer connection may only have one unanswered local offer. Track dirty
  // negotiation state per viewer so simultaneous joins/track changes coalesce
  // instead of replacing each other's pending offers.
  const negotiationStatesRef = useRef<Map<string, ViewerNegotiationState>>(new Map());
  const viewerGenerationsRef = useRef<Map<string, number>>(new Map());
  const negotiationSequenceRef = useRef(0);
  // Destination viewer ID -> source viewer ID -> sender. Keeping ownership
  // explicit makes relay replacement and source leave/rejoin idempotent.
  const relayedAudioSendersRef = useRef<Map<string, Map<string, RTCRtpSender>>>(new Map());
  // Destination viewer ID -> screen-share track kind -> sender. Screen audio,
  // host mic, and relayed viewer audio are all audio senders, so ownership must
  // be explicit rather than inferred from the first sender of a matching kind.
  const publishedStreamSendersRef = useRef<Map<string, Map<string, RTCRtpSender>>>(new Map());
  const publishedStreamVersionRef = useRef(0);
  // A host mute is a participant policy, not a peer-connection property. Keep
  // it across same-ID reconnects until the host explicitly unmutes or stops.
  const mutedViewerIdsRef = useRef<Set<string>>(new Set());
  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);

  // Keep refs updated
  localStreamRef.current = localStream;
  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;

  // Calculate network quality from stats
  const calculateNetworkQuality = useCallback(
    (packetLoss: number, roundTripTime: number): NetworkQuality => {
      if (packetLoss < 1 && roundTripTime < 50) {
        return 'excellent';
      } else if (packetLoss < 3 && roundTripTime < 100) {
        return 'good';
      } else if (packetLoss < 8 && roundTripTime < 200) {
        return 'poor';
      }
      return 'bad';
    },
    []
  );

  // Adjust bitrate for a viewer based on network quality
  const adjustBitrate = useCallback(async (viewer: ViewerConnection, quality: NetworkQuality) => {
    // Only adjust if quality changed
    if (viewer.currentPreset === quality) return;

    const preset = BITRATE_PRESETS[quality];
    const senders = viewer.peerConnection.getSenders();
    const videoSender = senders.find((s) => s.track?.kind === 'video');

    if (!videoSender) return;

    try {
      const params = videoSender.getParameters();
      const encoding = params.encodings[0];

      // Apply bitrate preset to first encoding if it exists
      if (encoding) {
        encoding.maxBitrate = preset.maxBitrate;
        encoding.scaleResolutionDownBy = preset.scaleResolutionDownBy;
        encoding.maxFramerate = preset.maxFramerate;
        await videoSender.setParameters(params);
        viewer.currentPreset = quality;
      }
    } catch (err) {
      console.error('Failed to adjust bitrate for viewer:', viewer.id, err);
    }
  }, []);

  // Collect stats and adjust bitrate for all viewers
  const collectStatsAndAdjust = useCallback(async () => {
    for (const viewer of viewersRef.current.values()) {
      if (viewer.connectionState !== 'connected') continue;

      try {
        const stats = await viewer.peerConnection.getStats();
        let packetLoss = 0;
        let roundTripTime = 0;
        let packetsLost = 0;
        let packetsSent = 0;

        stats.forEach((report: RTCStatsReport[keyof RTCStatsReport] & Record<string, unknown>) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            packetsSent = (report.packetsSent as number | undefined) ?? 0;
          }
          if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
            packetsLost = (report.packetsLost as number | undefined) ?? 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            roundTripTime = ((report.currentRoundTripTime as number | undefined) ?? 0) * 1000;
          }
        });

        // Calculate packet loss percentage
        if (packetsSent > 0) {
          packetLoss = (packetsLost / packetsSent) * 100;
        }

        const quality = calculateNetworkQuality(packetLoss, roundTripTime);
        viewer.networkQuality = quality;

        // Adjust bitrate based on network quality
        await adjustBitrate(viewer, quality);
      } catch {
        // Stats collection failed - non-critical
      }
    }
  }, [calculateNetworkQuality, adjustBitrate]);

  // Handle data channel messages from a viewer
  const handleDataChannelMessage = useCallback((viewerId: string, event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as ControlMessage | InputMessage;

      if ('type' in message) {
        switch (message.type) {
          case 'control-request':
            onControlRequestRef.current?.(viewerId);
            break;
          case 'control-revoke': {
            // Viewer is releasing control
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
      // Invalid message format - ignore
    }
  }, []);

  const requestViewerNegotiation = useCallback(
    async (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (!viewer) return;

      const pc = viewer.peerConnection;
      let negotiationState = negotiationStatesRef.current.get(viewerId);
      if (!negotiationState) {
        negotiationState = {
          needsNegotiation: false,
          makingOffer: false,
          applyingAnswer: false,
          generation: viewerGenerationsRef.current.get(viewerId) ?? 1,
          currentNegotiationId: null,
        };
        negotiationStatesRef.current.set(viewerId, negotiationState);
      }

      // Always remember the mutation. If an offer is already in flight, the
      // answer handler below will drain this request once the PC is stable.
      negotiationState.needsNegotiation = true;
      if (negotiationState.makingOffer || negotiationState.applyingAnswer || !canCreateOffer(pc)) {
        return;
      }

      negotiationState.makingOffer = true;
      negotiationState.needsNegotiation = false;
      const negotiationId = `${hostId}:${viewerId}:${String(negotiationState.generation)}:${String(++negotiationSequenceRef.current)}`;
      negotiationState.currentNegotiationId = negotiationId;

      try {
        const offer = await pc.createOffer();

        // The viewer may have left while createOffer was pending. Do not signal
        // an offer from a stale/closed peer connection.
        if (viewersRef.current.get(viewerId)?.peerConnection !== pc) return;

        // A second async signaling operation may have changed the state after
        // createOffer started. Preserve the dirty bit for the next stable turn.
        if (!canCreateOffer(pc)) {
          negotiationState.needsNegotiation = true;
          return;
        }

        // In-band FEC turns a lost packet into a duller syllable, not a gap.
        if (offer.sdp) offer.sdp = tuneOpusForVoice(offer.sdp);
        await pc.setLocalDescription(offer);

        // setLocalDescription can outlive a viewer that leaves and rejoins with
        // the same presence ID. Never signal an offer from the old generation.
        if (viewersRef.current.get(viewerId)?.peerConnection !== pc) return;

        if (offer.sdp) {
          void channelRef.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'offer',
              sdp: offer.sdp,
              senderId: hostId,
              targetId: viewerId,
              negotiationId,
              timestamp: Date.now(),
            } satisfies SignalMessage & { targetId: string },
          });
        }
      } catch (err) {
        // Keep the request pending so a later stable transition/change can
        // retry it instead of silently losing the added/removed track.
        negotiationState.needsNegotiation = true;
        throw err;
      } finally {
        negotiationState.makingOffer = false;
      }
    },
    [hostId]
  );

  // Relay a viewer's audio track to all other connected viewers via renegotiation
  const relayAudioToOtherViewers = useCallback(
    async (sourceViewerId: string, audioTrack: MediaStreamTrack) => {
      const audioStream = new MediaStream([audioTrack]);

      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        // A newer ontrack event or viewer removal supersedes this async relay.
        if (viewersRef.current.get(sourceViewerId)?.audioTrack !== audioTrack) return;
        if (otherId === sourceViewerId) continue;
        if (
          otherViewer.connectionState !== 'connected' &&
          otherViewer.connectionState !== 'connecting'
        )
          continue;

        try {
          let destinationSenders = relayedAudioSendersRef.current.get(otherId);
          if (!destinationSenders) {
            destinationSenders = new Map();
            relayedAudioSendersRef.current.set(otherId, destinationSenders);
          }

          const existingSender = destinationSenders.get(sourceViewerId);
          if (existingSender) {
            if (existingSender.track === audioTrack || existingSender.track?.id === audioTrack.id) {
              continue;
            }

            // Replace relay ownership synchronously. Awaiting replaceTrack here
            // lets a leave/rejoin race resurrect an old source after cleanup.
            otherViewer.peerConnection.removeTrack(existingSender);
            destinationSenders.delete(sourceViewerId);
          }

          // The source may have been synchronously removed by application code
          // while the previous sender was detached.
          if (viewersRef.current.get(sourceViewerId)?.audioTrack !== audioTrack) return;

          const relaySender = otherViewer.peerConnection.addTrack(audioTrack, audioStream);
          destinationSenders.set(sourceViewerId, relaySender);
          void prioritizeAudioSender(relaySender);
          console.log(`[WebRTCHost] Added ${sourceViewerId}'s audio to ${otherId}, renegotiating`);
          await requestViewerNegotiation(otherId);
        } catch (err) {
          console.error(`[WebRTCHost] Failed to relay audio to ${otherId}:`, err);
        }
      }
    },
    [requestViewerNegotiation]
  );

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    (viewerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
      });
      const relayedAudioSenders = new Map<string, RTCRtpSender>();
      relayedAudioSendersRef.current.set(viewerId, relayedAudioSenders);
      const publishedStreamSenders = new Map<string, RTCRtpSender>();
      publishedStreamSendersRef.current.set(viewerId, publishedStreamSenders);

      // Add local stream tracks with screen sharing optimizations (if currently sharing)
      const currentStream = localStreamRef.current;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => {
          // Set content hint for video tracks to optimize for screen content (text/graphics)
          if (track.kind === 'video') {
            // 'detail' hint tells encoder to prioritize sharpness over smoothness
            track.contentHint = 'detail';
          }

          const sender = pc.addTrack(track, currentStream);
          publishedStreamSenders.set(track.kind, sender);

          // Configure video sender with high-quality encoding parameters
          if (track.kind === 'video') {
            const params = sender.getParameters();
            // Set initial encoding to excellent quality preset
            const preset = BITRATE_PRESETS.excellent;
            const encoding = params.encodings[0];
            if (encoding) {
              encoding.maxBitrate = preset.maxBitrate;
              encoding.maxFramerate = preset.maxFramerate;
              // Screen video deliberately ranks BELOW audio. It can shed
              // resolution or framerate and stay useful; voice cannot shed
              // anything without going choppy, so audio gets the pipe first.
              encoding.networkPriority = VIDEO_NETWORK_PRIORITY;
            }
            void sender.setParameters(params).catch(() => {
              // Some browsers may not support all parameters
            });
          }
        });
      }

      // Add host mic audio track so viewers hear the host
      const hostMic = hostMicStreamRef.current;
      if (hostMic) {
        hostMic.getAudioTracks().forEach((track) => {
          void prioritizeAudioSender(pc.addTrack(track, hostMic));
        });
      }

      // Add existing viewers' audio tracks to this new viewer's PC
      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        if (otherId === viewerId) continue;
        // Keep muted sources negotiated too. Their relay carries silence while
        // muted and resumes automatically without another addTrack/offer.
        if (otherViewer.audioTrack) {
          const audioStream = new MediaStream([otherViewer.audioTrack]);
          const relaySender = pc.addTrack(otherViewer.audioTrack, audioStream);
          relayedAudioSenders.set(otherId, relaySender);
          void prioritizeAudioSender(relaySender);
        }
      }

      // Handle incoming tracks from viewer (their mic audio)
      pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer?.peerConnection !== pc) return;

          console.log(`[WebRTCHost] Received audio track from viewer: ${viewerId}`);
          const isCurrentTrack =
            viewer.audioTrack === event.track || viewer.audioTrack?.id === event.track.id;
          if (!isCurrentTrack) {
            disposeViewerAudioPlayback(viewer);
            viewer.audioTrack = event.track;
          }
          // Enforce host mute immediately even before the control data channel
          // opens; the same disabled track is also what gets relayed.
          event.track.enabled = !viewer.isMuted;

          if (!viewer.amplifiedAudio || !viewer.audioElement) {
            // Play viewer audio locally for host to hear. The element's own
            // volume tops out at 1.0, so the track goes through a gain stage
            // first — the only way to make a quiet talker actually louder.
            try {
              const amplified = amplifyRemoteAudio(event.track, speakerGainRef.current);
              viewer.amplifiedAudio = amplified;

              const audioEl = new Audio();
              audioEl.srcObject = amplified.stream;
              audioEl.autoplay = true;
              audioEl.volume = 1.0;
              void audioEl.play().catch((err: unknown) => {
                console.warn('[WebRTCHost] Failed to play viewer audio:', err);
              });
              viewer.audioElement = audioEl;
            } catch (err) {
              // Local playback failure must not prevent this track from being
              // relayed to the other participants.
              disposeViewerAudioPlayback(viewer);
              console.warn('[WebRTCHost] Failed to prepare viewer audio:', err);
            }
          }

          setViewers(new Map(viewersRef.current));

          // Relay this viewer's audio to all other viewers.
          void relayAudioToOtherViewers(viewerId, event.track);
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (viewersRef.current.get(viewerId)?.peerConnection !== pc) return;
        if (event.candidate) {
          void channelRef.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'ice-candidate',
              candidate: event.candidate.toJSON(),
              senderId: hostId,
              targetId: viewerId,
              timestamp: Date.now(),
            },
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
      const dc = pc.createDataChannel('control', {
        ordered: true,
      });

      dc.onopen = () => {
        const viewer = viewersRef.current.get(viewerId);
        if (viewer?.peerConnection === pc) {
          viewer.dataChannel = dc;
          if (viewer.isMuted) {
            const message: MuteMessage = {
              type: 'mute',
              participantId: viewerId,
              muted: true,
              timestamp: Date.now(),
            };
            dc.send(JSON.stringify(message));
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
        const viewer = viewersRef.current.get(viewerId);
        if (viewer?.peerConnection !== pc || viewer.dataChannel !== dc) return;
        handleDataChannelMessage(viewerId, event);
      };

      return pc;
    },
    [hostId, handleDataChannelMessage, relayAudioToOtherViewers]
  );

  const removeRelayedAudioSource = useCallback(
    (sourceViewerId: string) => {
      for (const [destinationId, destinationViewer] of viewersRef.current.entries()) {
        if (destinationId === sourceViewerId) continue;

        const destinationSenders = relayedAudioSendersRef.current.get(destinationId);
        if (!destinationSenders) continue;
        const relaySender = destinationSenders.get(sourceViewerId);
        if (!relaySender) continue;

        // Delete ownership first so a repeated leave/rejoin cannot remove or
        // replace the new source's sender by mistake.
        destinationSenders.delete(sourceViewerId);
        try {
          destinationViewer.peerConnection.removeTrack(relaySender);
          void requestViewerNegotiation(destinationId).catch((err: unknown) => {
            console.error(
              `[WebRTCHost] Failed to remove ${sourceViewerId}'s relay from ${destinationId}:`,
              err
            );
          });
        } catch (err) {
          console.error(
            `[WebRTCHost] Failed to remove ${sourceViewerId}'s relay from ${destinationId}:`,
            err
          );
        }
      }
    },
    [requestViewerNegotiation]
  );

  // Remove a viewer
  const removeViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer) {
        removeRelayedAudioSource(viewerId);
        relayedAudioSendersRef.current.delete(viewerId);
        publishedStreamSendersRef.current.delete(viewerId);
        disposeViewerAudioPlayback(viewer);
        viewer.peerConnection.close();
        viewersRef.current.delete(viewerId);
        pendingCandidatesRef.current.delete(viewerId);
        negotiationStatesRef.current.delete(viewerId);
        setViewers(new Map(viewersRef.current));
        onViewerLeft?.(viewerId);
      }
    },
    [onViewerLeft, removeRelayedAudioSource]
  );

  // Keep ref updated
  removeViewerRef.current = removeViewer;

  // Handle incoming signal messages
  const handleSignalMessage = useCallback(
    async (message: SignalMessage & { targetId?: string }) => {
      // Only process messages targeted to this host or without a target
      if (message.targetId && message.targetId !== hostId) return;

      const viewerId = message.senderId;

      switch (message.type) {
        case 'answer': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && message.sdp) {
            const pc = viewer.peerConnection;
            const negotiationState = negotiationStatesRef.current.get(viewerId);
            const isCorrelatedAnswer =
              message.negotiationId === negotiationState?.currentNegotiationId;
            // Older desktop/mobile clients do not send negotiation IDs. Keep
            // accepting those messages across reconnects while using exact ID
            // matching whenever the peer supports the newer protocol.
            const isLegacyAnswer = !message.negotiationId;
            if (
              !negotiationState?.currentNegotiationId ||
              (!isCorrelatedAnswer && !isLegacyAnswer)
            ) {
              console.warn(`[WebRTCHost] Ignoring stale or uncorrelated answer from ${viewerId}`);
              break;
            }
            // Only set remote description if we're expecting an answer
            if (pc.signalingState !== 'have-local-offer' || negotiationState.applyingAnswer) {
              console.warn(
                `[WebRTCHost] Ignoring answer from ${viewerId} — signaling state is ${pc.signalingState}`
              );
              break;
            }

            negotiationState.applyingAnswer = true;
            try {
              await pc.setRemoteDescription({
                type: 'answer',
                sdp: message.sdp,
              });

              // An answer may resolve after this ID has left and rejoined. Do
              // not consume the new generation's ICE or negotiation state.
              if (
                viewersRef.current.get(viewerId)?.peerConnection !== pc ||
                negotiationStatesRef.current.get(viewerId) !== negotiationState
              ) {
                return;
              }

              // Drain any ICE candidates that arrived before the answer
              const pending = pendingCandidatesRef.current.get(viewerId);
              if (pending && pending.length > 0) {
                console.log(
                  `[WebRTCHost] Draining ${String(pending.length)} buffered ICE candidates for ${viewerId}`
                );
                pendingCandidatesRef.current.delete(viewerId);
                for (const candidate of pending) {
                  try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                  } catch (err) {
                    console.warn(
                      `[WebRTCHost] Ignoring invalid ICE candidate from ${viewerId}`,
                      err
                    );
                  }
                }
              }
            } finally {
              if (negotiationStatesRef.current.get(viewerId) === negotiationState) {
                negotiationState.applyingAnswer = false;
              }
            }

            // Track changes that arrived while this offer was outstanding are
            // deliberately coalesced into the next stable negotiation.
            if (
              viewersRef.current.get(viewerId)?.peerConnection === pc &&
              negotiationStatesRef.current.get(viewerId) === negotiationState &&
              negotiationState.needsNegotiation
            ) {
              void requestViewerNegotiation(viewerId).catch((err: unknown) => {
                console.error(`[WebRTCHost] Failed to renegotiate with ${viewerId}:`, err);
              });
            }
          }
          break;
        }

        case 'ice-candidate': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && message.candidate.candidate) {
            // Buffer if remote description not yet set
            if (!viewer.peerConnection.remoteDescription) {
              const pending = pendingCandidatesRef.current.get(viewerId) ?? [];
              pending.push(message.candidate);
              pendingCandidatesRef.current.set(viewerId, pending);
            } else {
              try {
                await viewer.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
              } catch (err) {
                // Candidates can legitimately trickle after a later SDP offer
                // on the same connection. Ignore stale ICE generations without
                // failing the signaling queue.
                console.warn(`[WebRTCHost] Ignoring invalid ICE candidate from ${viewerId}`, err);
              }
            }
          }
          break;
        }
      }
    },
    [hostId, requestViewerNegotiation]
  );

  // Handle viewer joining (presence)
  const handleViewerJoin = useCallback(
    async (viewerId: string) => {
      if (viewerId === hostId) return; // Don't connect to self
      if (viewersRef.current.has(viewerId)) return; // Already connected

      // Create peer connection for this viewer
      const pc = createPeerConnection(viewerId);
      const generation = (viewerGenerationsRef.current.get(viewerId) ?? 0) + 1;
      viewerGenerationsRef.current.set(viewerId, generation);

      const viewer: ViewerConnection = {
        id: viewerId,
        peerConnection: pc,
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
      negotiationStatesRef.current.set(viewerId, {
        needsNegotiation: false,
        makingOffer: false,
        applyingAnswer: false,
        generation,
        currentNegotiationId: null,
      });
      setViewers(new Map(viewersRef.current));
      onViewerJoined?.(viewerId);

      // Create and send offer
      try {
        await requestViewerNegotiation(viewerId);
      } catch (err) {
        console.error('Failed to create offer for viewer:', viewerId, err);
        if (viewersRef.current.get(viewerId)?.peerConnection === pc) {
          removeViewer(viewerId);
        }
      }
    },
    [hostId, createPeerConnection, onViewerJoined, removeViewer, requestViewerNegotiation]
  );

  // Start hosting (sets up signaling channel and voice -- screen sharing is optional)
  const startHosting = useCallback(async () => {
    // Capture host microphone before setting up signaling
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: VOICE_AUDIO_CONSTRAINTS,
        video: false,
      });
      markTrackAsSpeech(micStream.getAudioTracks()[0]);
      hostMicStreamRef.current = micStream;
      setHasMic(true);
      setMicEnabled(true);
      console.log('[WebRTCHost] Host microphone captured');
    } catch (err: unknown) {
      console.warn('[WebRTCHost] Could not access microphone, hosting without audio:', err);
      hostMicStreamRef.current = null;
      setHasMic(false);
      setMicEnabled(false);
    }

    const supabase = createClient();

    const channel = supabase.channel(`session:${sessionId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: hostId },
      },
    });

    channelRef.current = channel;

    // Subscribe to signaling events
    channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        void handleSignalMessage(payload as SignalMessage & { targetId?: string });
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        newPresences.forEach((presence) => {
          const viewerId = presence.user_id as string;
          if (viewerId && presence.role === 'viewer') {
            void handleViewerJoin(viewerId);
          }
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        leftPresences.forEach((presence) => {
          const viewerId = presence.user_id as string;
          if (viewerId) {
            removeViewer(viewerId);
          }
        });
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setIsHosting(true);
          setError(null);

          // Track host presence
          void channel.track({
            user_id: hostId,
            online_at: new Date().toISOString(),
            role: 'host',
          });

          // Start adaptive bitrate monitoring
          statsIntervalRef.current = setInterval(() => {
            void collectStatsAndAdjust();
          }, STATS_INTERVAL);
        }
      });
  }, [
    sessionId,
    hostId,
    handleSignalMessage,
    handleViewerJoin,
    removeViewer,
    collectStatsAndAdjust,
  ]);

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

  // Stop hosting
  const stopHosting = useCallback(() => {
    // Stop adaptive bitrate monitoring
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    // Stop host mic tracks
    if (hostMicStreamRef.current) {
      hostMicStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      hostMicStreamRef.current = null;
    }

    // Close all viewer connections
    viewersRef.current.forEach((viewer) => {
      disposeViewerAudioPlayback(viewer);
      viewer.peerConnection.close();
    });
    viewersRef.current.clear();
    negotiationStatesRef.current.clear();
    viewerGenerationsRef.current.clear();
    relayedAudioSendersRef.current.clear();
    publishedStreamSendersRef.current.clear();
    publishedStreamVersionRef.current++;
    pendingCandidatesRef.current.clear();
    mutedViewerIdsRef.current.clear();
    setViewers(new Map());

    // Unsubscribe from channel
    if (channelRef.current) {
      void channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    setIsHosting(false);
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  // Publish a screen share stream to all connected viewers
  const publishStream = useCallback(
    async (stream: MediaStream) => {
      localStreamRef.current = stream;
      const publishVersion = ++publishedStreamVersionRef.current;

      // Add or replace only senders owned by the published screen stream. Host
      // mic and viewer relay senders must never be selected by track kind.
      for (const viewer of viewersRef.current.values()) {
        if (
          publishedStreamVersionRef.current !== publishVersion ||
          localStreamRef.current !== stream
        )
          break;
        if (viewer.connectionState !== 'connected' && viewer.connectionState !== 'connecting')
          continue;

        try {
          let publishedSenders = publishedStreamSendersRef.current.get(viewer.id);
          if (!publishedSenders) {
            publishedSenders = new Map();
            publishedStreamSendersRef.current.set(viewer.id, publishedSenders);
          }

          const desiredTracks = new Map(stream.getTracks().map((track) => [track.kind, track]));
          let negotiationNeeded = false;

          for (const [kind, sender] of publishedSenders.entries()) {
            const desiredTrack = desiredTracks.get(kind);
            if (!desiredTrack || sender.track !== desiredTrack) {
              viewer.peerConnection.removeTrack(sender);
              publishedSenders.delete(kind);
              negotiationNeeded = true;
            }
          }

          for (const track of desiredTracks.values()) {
            if (track.kind === 'video') {
              track.contentHint = 'detail';
            }
            if (!publishedSenders.has(track.kind)) {
              const sender = viewer.peerConnection.addTrack(track, stream);
              publishedSenders.set(track.kind, sender);
              if (track.kind === 'audio') void prioritizeAudioSender(sender);
              negotiationNeeded = true;
            }
          }

          if (negotiationNeeded) await requestViewerNegotiation(viewer.id);
        } catch (err) {
          console.error(`[WebRTCHost] Failed to publish stream to ${viewer.id}:`, err);
        }
      }
    },
    [requestViewerNegotiation]
  );

  // Unpublish the screen share stream without closing voice connections.
  const unpublishStream = useCallback(async () => {
    localStreamRef.current = null;
    const unpublishVersion = ++publishedStreamVersionRef.current;

    for (const viewer of viewersRef.current.values()) {
      if (publishedStreamVersionRef.current !== unpublishVersion) break;
      if (viewer.connectionState !== 'connected' && viewer.connectionState !== 'connecting')
        continue;

      try {
        const publishedSenders = publishedStreamSendersRef.current.get(viewer.id);
        let negotiationNeeded = false;
        for (const sender of publishedSenders?.values() ?? []) {
          viewer.peerConnection.removeTrack(sender);
          negotiationNeeded = true;
        }
        publishedSenders?.clear();

        if (negotiationNeeded) await requestViewerNegotiation(viewer.id);
      } catch (err) {
        console.error(`[WebRTCHost] Failed to unpublish stream from ${viewer.id}:`, err);
      }
    }
  }, [requestViewerNegotiation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);

  // Grant control to a viewer
  const grantControl = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer?.dataChannel?.readyState !== 'open') return;

      // Revoke from any other viewer first
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

      // Grant to new viewer
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

  // Revoke control from a viewer
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

  // Kick a viewer from the session
  const kickViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (!viewer) return;

      // Send kick notification before closing (if data channel is open)
      if (viewer.dataChannel?.readyState === 'open') {
        const message: KickMessage = {
          type: 'kick',
          timestamp: Date.now(),
        };
        viewer.dataChannel.send(JSON.stringify(message));
      }

      // Clear controlling viewer if this viewer had control
      if (controllingViewer === viewerId) {
        setControllingViewer(null);
      }

      removeRelayedAudioSource(viewerId);
      relayedAudioSendersRef.current.delete(viewerId);
      publishedStreamSendersRef.current.delete(viewerId);
      disposeViewerAudioPlayback(viewer);

      // Close the peer connection
      viewer.peerConnection.close();
      viewersRef.current.delete(viewerId);
      pendingCandidatesRef.current.delete(viewerId);
      negotiationStatesRef.current.delete(viewerId);
      setViewers(new Map(viewersRef.current));
      onViewerLeft?.(viewerId);
    },
    [controllingViewer, onViewerLeft, removeRelayedAudioSource]
  );

  // Mute/unmute a viewer
  const muteViewer = useCallback((viewerId: string, muted: boolean) => {
    const viewer = viewersRef.current.get(viewerId);
    if (!viewer) return;

    if (muted) mutedViewerIdsRef.current.add(viewerId);
    else mutedViewerIdsRef.current.delete(viewerId);

    // Apply the policy to the received track immediately. If the control
    // channel is not open yet, onopen synchronizes the same state back to the
    // viewer's microphone source.
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
    // Host microphone
    micEnabled,
    hasMic,
    toggleMic,
    micStream: hostMicStreamRef.current,
  };
}
