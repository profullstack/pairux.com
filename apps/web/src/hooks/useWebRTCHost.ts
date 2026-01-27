import { useState, useEffect, useRef, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type {
  ConnectionState,
  SignalMessage,
  InputMessage,
  ControlMessage,
  CursorPositionMessage,
  ControlStateUI,
  NetworkQuality,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';

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
  onCursorUpdate?: (viewerId: string, cursor: CursorPositionMessage) => void;
}

interface UseWebRTCHostReturn {
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
  muteViewer: (viewerId: string, muted: boolean) => void;
  // Host microphone
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
  micStream: MediaStream | null;
}

export function useWebRTCHost({
  sessionId,
  hostId,
  localStream,
  onViewerJoined,
  onViewerLeft,
  onControlRequest,
  onInputReceived,
  onCursorUpdate,
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
  const onControlRequestRef = useRef(onControlRequest);
  const onInputReceivedRef = useRef(onInputReceived);
  const onCursorUpdateRef = useRef(onCursorUpdate);

  // Keep refs updated
  onControlRequestRef.current = onControlRequest;
  onInputReceivedRef.current = onInputReceived;
  onCursorUpdateRef.current = onCursorUpdate;

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
          case 'cursor':
            onCursorUpdateRef.current?.(viewerId, message);
            break;
        }
      }
    } catch {
      // Invalid message format - ignore
    }
  }, []);

  // Relay a viewer's audio track to all other connected viewers via renegotiation
  const relayAudioToOtherViewers = useCallback(
    async (sourceViewerId: string, audioTrack: MediaStreamTrack) => {
      const audioStream = new MediaStream([audioTrack]);

      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        if (otherId === sourceViewerId) continue;
        if (
          otherViewer.connectionState !== 'connected' &&
          otherViewer.connectionState !== 'connecting'
        )
          continue;

        try {
          otherViewer.peerConnection.addTrack(audioTrack, audioStream);
          console.log(`[WebRTCHost] Added ${sourceViewerId}'s audio to ${otherId}, renegotiating`);

          // Renegotiate
          const offer = await otherViewer.peerConnection.createOffer();
          await otherViewer.peerConnection.setLocalDescription(offer);

          if (offer.sdp) {
            void channelRef.current?.send({
              type: 'broadcast',
              event: 'signal',
              payload: {
                type: 'offer',
                sdp: offer.sdp,
                senderId: hostId,
                targetId: otherId,
                timestamp: Date.now(),
              },
            });
          }
        } catch (err) {
          console.error(`[WebRTCHost] Failed to relay audio to ${otherId}:`, err);
        }
      }
    },
    [hostId]
  );

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    (viewerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
      });

      // Add local stream tracks with screen sharing optimizations
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          // Set content hint for video tracks to optimize for screen content (text/graphics)
          if (track.kind === 'video') {
            // 'detail' hint tells encoder to prioritize sharpness over smoothness
            track.contentHint = 'detail';
          }

          const sender = pc.addTrack(track, localStream);

          // Configure video sender with high-quality encoding parameters
          if (track.kind === 'video') {
            const params = sender.getParameters();
            // Set initial encoding to excellent quality preset
            const preset = BITRATE_PRESETS.excellent;
            const encoding = params.encodings[0];
            if (encoding) {
              encoding.maxBitrate = preset.maxBitrate;
              encoding.maxFramerate = preset.maxFramerate;
              // Priority: high for screen sharing
              encoding.priority = 'high';
              encoding.networkPriority = 'high';
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
          pc.addTrack(track, hostMic);
        });
      }

      // Add existing viewers' audio tracks to this new viewer's PC
      for (const [otherId, otherViewer] of viewersRef.current.entries()) {
        if (otherId === viewerId) continue;
        if (otherViewer.audioTrack && !otherViewer.isMuted) {
          const audioStream = new MediaStream([otherViewer.audioTrack]);
          pc.addTrack(otherViewer.audioTrack, audioStream);
        }
      }

      // Handle incoming tracks from viewer (their mic audio)
      pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          console.log(`[WebRTCHost] Received audio track from viewer: ${viewerId}`);
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            viewer.audioTrack = event.track;

            // Play viewer audio locally for host to hear
            const audioEl = new Audio();
            audioEl.srcObject = new MediaStream([event.track]);
            audioEl.autoplay = true;
            audioEl.volume = 1.0;
            void audioEl.play().catch((err: unknown) => {
              console.warn('[WebRTCHost] Failed to play viewer audio:', err);
            });
            viewer.audioElement = audioEl;

            setViewers(new Map(viewersRef.current));

            // Relay this viewer's audio to all other viewers
            void relayAudioToOtherViewers(viewerId, event.track);
          }
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

          viewer.connectionState = newState;
          setViewers(new Map(viewersRef.current));

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

      return pc;
    },
    [localStream, hostId, handleDataChannelMessage, relayAudioToOtherViewers]
  );

  // Remove a viewer
  const removeViewer = useCallback(
    (viewerId: string) => {
      const viewer = viewersRef.current.get(viewerId);
      if (viewer) {
        if (viewer.audioElement) {
          viewer.audioElement.pause();
          viewer.audioElement.srcObject = null;
        }
        viewer.peerConnection.close();
        viewersRef.current.delete(viewerId);
        setViewers(new Map(viewersRef.current));
        onViewerLeft?.(viewerId);
      }
    },
    [onViewerLeft]
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
            // Only set remote description if we're expecting an answer
            if (viewer.peerConnection.signalingState !== 'have-local-offer') {
              console.warn(
                `[WebRTCHost] Ignoring answer from ${viewerId} — signaling state is ${viewer.peerConnection.signalingState}`
              );
              break;
            }
            await viewer.peerConnection.setRemoteDescription({
              type: 'answer',
              sdp: message.sdp,
            });
          }
          break;
        }

        case 'ice-candidate': {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer && message.candidate.candidate) {
            await viewer.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
          }
          break;
        }
      }
    },
    [hostId]
  );

  // Handle viewer joining (presence)
  const handleViewerJoin = useCallback(
    async (viewerId: string) => {
      if (viewerId === hostId) return; // Don't connect to self
      if (viewersRef.current.has(viewerId)) return; // Already connected

      // Create peer connection for this viewer
      const pc = createPeerConnection(viewerId);

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
        isMuted: false,
      };

      viewersRef.current.set(viewerId, viewer);
      setViewers(new Map(viewersRef.current));
      onViewerJoined?.(viewerId);

      // Create and send offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (offer.sdp) {
          void channelRef.current?.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'offer',
              sdp: offer.sdp,
              senderId: hostId,
              targetId: viewerId,
              timestamp: Date.now(),
            } satisfies SignalMessage & { targetId: string },
          });
        }
      } catch (err) {
        console.error('Failed to create offer for viewer:', viewerId, err);
        removeViewer(viewerId);
      }
    },
    [hostId, createPeerConnection, onViewerJoined, removeViewer]
  );

  // Start hosting
  const startHosting = useCallback(async () => {
    if (!localStream) {
      setError('No stream available. Please start screen sharing first.');
      return;
    }

    // Capture host microphone before setting up signaling
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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
    localStream,
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
      if (viewer.audioElement) {
        viewer.audioElement.pause();
        viewer.audioElement.srcObject = null;
      }
      viewer.peerConnection.close();
    });
    viewersRef.current.clear();
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);

  // Update stream when it changes (add/remove tracks)
  useEffect(() => {
    if (!localStream || !isHosting) return;

    // Update tracks for all connected viewers
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

      // Clean up audio element
      if (viewer.audioElement) {
        viewer.audioElement.pause();
        viewer.audioElement.srcObject = null;
      }

      // Close the peer connection
      viewer.peerConnection.close();
      viewersRef.current.delete(viewerId);
      setViewers(new Map(viewersRef.current));
      onViewerLeft?.(viewerId);
    },
    [controllingViewer, onViewerLeft]
  );

  // Mute/unmute a viewer
  const muteViewer = useCallback((viewerId: string, muted: boolean) => {
    const viewer = viewersRef.current.get(viewerId);
    if (!viewer) return;

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
