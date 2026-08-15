import { useState, useEffect, useRef, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type {
  ConnectionState,
  QualityMetrics,
  NetworkQuality,
  SignalMessage,
  InputMessage,
  InputEvent,
  ControlMessage,
  ControlStateUI,
  KickMessage,
  MuteMessage,
} from '@pairux/shared-types';
import {
  VOICE_AUDIO_CONSTRAINTS,
  prioritizeAudioSender,
  tuneOpusForVoice,
  markTrackAsSpeech,
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
  useApiSignalPost?: boolean;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnded?: () => void;
  onControlStateChange?: (state: ControlStateUI) => void;
  onKicked?: (reason?: string) => void;
}

interface UseWebRTCReturn {
  connectionState: ConnectionState;
  remoteStream: MediaStream | null;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
  // Remote control
  controlState: ControlStateUI;
  dataChannelReady: boolean;
  requestControl: () => void;
  releaseControl: () => void;
  sendInput: (event: InputEvent) => void;
  // Microphone
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: () => void;
}

export function useWebRTC({
  sessionId,
  participantId,
  useApiSignalPost = false,
  onStreamReady,
  onStreamEnded,
  onControlStateChange,
  onKicked,
}: UseWebRTCOptions): UseWebRTCReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics | null>(null);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('good');
  const [error, setError] = useState<string | null>(null);
  const [controlState, setControlState] = useState<ControlStateUI>('view-only');
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteTrackCleanupRef = useRef<Map<string, () => void>>(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const inputSequenceRef = useRef(0);
  const hostPeerIdRef = useRef<string | null>(null);
  const maxReconnectAttempts = 3;

  const sendSignal = useCallback(
    async (payload: SignalMessage) => {
      if (useApiSignalPost) {
        try {
          const response = await fetch(`/api/sessions/${sessionId}/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            console.error('[WebRTC] Failed to send signal:', await response.text());
          }
        } catch (err) {
          console.error('[WebRTC] Error sending signal:', err);
        }
        return;
      }

      void channelRef.current?.send({
        type: 'broadcast',
        event: 'signal',
        payload,
      });
    },
    [sessionId, useApiSignalPost]
  );

  // Buffer ICE candidates that arrive before remote description is set
  const pendingCandidatesRef = useRef<{ candidate: RTCIceCandidateInit; senderId: string }[]>([]);
  // Serialize signaling message processing to prevent race conditions
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Use refs to avoid circular dependencies in callbacks
  const handleConnectionFailureRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const onControlStateChangeRef = useRef(onControlStateChange);
  const onKickedRef = useRef(onKicked);
  const disconnectRef = useRef<(() => void) | undefined>(undefined);

  // Keep refs updated
  onControlStateChangeRef.current = onControlStateChange;
  onKickedRef.current = onKicked;

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

  // Handle incoming data channel messages
  const handleDataChannelMessage = useCallback((event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as ControlMessage | KickMessage | MuteMessage;

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
          case 'kick':
            // Host kicked this viewer
            setError('You were removed from the session');
            disconnectRef.current?.();
            onKickedRef.current?.(message.reason);
            break;
          case 'mute': {
            // Host force-muted/unmuted this viewer's mic
            const micStream = micStreamRef.current;
            if (micStream) {
              micStream.getAudioTracks().forEach((track) => {
                track.enabled = !message.muted;
              });
              setMicEnabled(!message.muted);
            }
            break;
          }
        }
      }
    } catch {
      // Invalid message format - ignore
    }
  }, []);

  // Setup data channel
  const setupDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;

      channel.onopen = () => {
        if (dataChannelRef.current !== channel) return;
        setDataChannelReady(true);
      };

      channel.onclose = () => {
        if (dataChannelRef.current !== channel) return;
        dataChannelRef.current = null;
        setDataChannelReady(false);
        setControlState('view-only');
      };

      channel.onerror = (err) => {
        if (dataChannelRef.current !== channel) return;
        console.error('Data channel error:', err);
        setDataChannelReady(false);
      };

      channel.onmessage = (event) => {
        if (dataChannelRef.current !== channel) return;
        handleDataChannelMessage(event as MessageEvent<string>);
      };
    },
    [handleDataChannelMessage]
  );

  // Request control from host
  const requestControl = useCallback(() => {
    const dc = dataChannelRef.current;
    if (dc?.readyState !== 'open') return;

    setControlState('requested');
    onControlStateChangeRef.current?.('requested');

    const message: ControlMessage = {
      type: 'control-request',
      participantId,
      timestamp: Date.now(),
    };

    dc.send(JSON.stringify(message));
  }, [participantId]);

  // Release control back to host
  const releaseControl = useCallback(() => {
    const dc = dataChannelRef.current;
    if (dc?.readyState !== 'open') return;

    setControlState('view-only');
    onControlStateChangeRef.current?.('view-only');

    const message: ControlMessage = {
      type: 'control-revoke',
      participantId,
      timestamp: Date.now(),
    };

    dc.send(JSON.stringify(message));
  }, [participantId]);

  // Send input event to host
  const sendInput = useCallback(
    (event: InputEvent) => {
      const dc = dataChannelRef.current;
      if (dc?.readyState !== 'open' || controlState !== 'granted') return;

      const message: InputMessage = {
        type: 'input',
        timestamp: Date.now(),
        sequence: inputSequenceRef.current++,
        event,
      };

      dc.send(JSON.stringify(message));
    },
    [controlState]
  );

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

  // Process a single signaling message (called sequentially via signalQueueRef)
  const processSignalMessage = useCallback(
    async (message: SignalMessage) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      // Shared realtime channels carry signaling for every participant. Reject
      // messages meant for another viewer, and never let a later peer replace
      // the host selected by the first successfully applied offer.
      if (message.targetId && message.targetId !== participantId) return;
      if (hostPeerIdRef.current && message.senderId !== hostPeerIdRef.current) return;

      try {
        switch (message.type) {
          case 'offer': {
            // If we're not in 'stable' state (e.g. already processing an offer),
            // rollback first so we can accept the new offer.
            if (pc.signalingState !== 'stable') {
              console.warn(`[WebRTC] Received offer in ${pc.signalingState} state — rolling back`);
              await pc.setLocalDescription({ type: 'rollback' });
            }

            await pc.setRemoteDescription({
              type: 'offer',
              sdp: message.sdp,
            });
            hostPeerIdRef.current ??= message.senderId;

            const answer = await pc.createAnswer();
            // In-band FEC turns a lost packet into a duller syllable, not a gap.
            if (answer.sdp) answer.sdp = tuneOpusForVoice(answer.sdp);
            await pc.setLocalDescription(answer);

            // Send answer back via signaling channel
            if (answer.sdp) {
              void sendSignal({
                type: 'answer',
                sdp: answer.sdp,
                senderId: participantId,
                targetId: message.senderId,
                ...(message.negotiationId ? { negotiationId: message.negotiationId } : {}),
                timestamp: Date.now(),
              });
            }

            // Drain any ICE candidates that arrived before remote description was set
            const pending = pendingCandidatesRef.current.filter(
              ({ senderId }) => senderId === message.senderId
            );
            pendingCandidatesRef.current = [];
            if (pending.length > 0) {
              console.log(`[WebRTC] Draining ${String(pending.length)} buffered ICE candidates`);
              for (const { candidate } of pending) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  // A candidate from an earlier ICE generation can arrive
                  // after renegotiation. Ignore it without dropping the rest.
                  console.warn('[WebRTC] Ignoring invalid buffered ICE candidate', err);
                }
              }
            }
            break;
          }

          case 'ice-candidate': {
            if (message.candidate.candidate) {
              // ICE gathering is scoped to the peer connection rather than a
              // single SDP offer. A late candidate from an earlier offer can
              // still be required after a relay-triggered renegotiation.
              if (!pc.remoteDescription) {
                pendingCandidatesRef.current.push({
                  candidate: message.candidate,
                  senderId: message.senderId,
                });
              } else {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
                } catch (err) {
                  console.warn('[WebRTC] Ignoring invalid ICE candidate', err);
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error('Error handling signal message:', err);
        setError('Failed to process signaling message');
      }
    },
    [participantId, sendSignal]
  );

  // Handle signaling messages — serialized via promise chain
  const handleSignalMessage = useCallback(
    (message: SignalMessage) => {
      if (message.targetId && message.targetId !== participantId) return;
      if (hostPeerIdRef.current && message.senderId !== hostPeerIdRef.current) return;

      signalQueueRef.current = signalQueueRef.current.then(() => processSignalMessage(message));
    },
    [participantId, processSignalMessage]
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
            const targetId = hostPeerIdRef.current;
            void sendSignal({
              type: 'offer',
              sdp: offer.sdp,
              senderId: participantId,
              ...(targetId ? { targetId } : {}),
              timestamp: Date.now(),
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
  }, [participantId, sendSignal]);

  // Keep ref updated
  handleConnectionFailureRef.current = handleConnectionFailure;

  const removeRemoteTrack = useCallback(
    (trackId: string) => {
      const cleanup = remoteTrackCleanupRef.current.get(trackId);
      remoteTrackCleanupRef.current.delete(trackId);
      cleanup?.();

      const activeStream = remoteStreamRef.current;
      if (!activeStream) return;

      const remainingTracks = activeStream
        .getTracks()
        .filter((track) => track.id !== trackId && track.readyState !== 'ended');
      if (remainingTracks.length === activeStream.getTracks().length) return;

      if (remainingTracks.length === 0) {
        remoteStreamRef.current = null;
        setRemoteStream(null);
        onStreamEnded?.();
        return;
      }

      const updatedStream = new MediaStream(remainingTracks);
      remoteStreamRef.current = updatedStream;
      setRemoteStream(updatedStream);
      onStreamReady?.(updatedStream);
    },
    [onStreamEnded, onStreamReady]
  );

  // Create and configure peer connection
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
    });

    // Handle incoming tracks (video + audio from host and relayed viewers)
    pc.ontrack = (event) => {
      if (peerConnectionRef.current !== pc) return;
      const incomingStream = event.streams[0];

      // Browsers may deliver audio/video on separate streams (or streamless) across
      // renegotiation, which can cause us to drop audio if we simply replace the stream.
      // There can be one remote audio track for the host and one for every relayed
      // viewer, so audio tracks must coexist. Screen sharing still has a single
      // active video source and a republished video replaces the previous one.
      const current = remoteStreamRef.current;
      const composite = current ?? new MediaStream();

      const detachTrackCleanup = (trackId: string) => {
        const cleanup = remoteTrackCleanupRef.current.get(trackId);
        remoteTrackCleanupRef.current.delete(trackId);
        cleanup?.();
      };

      const registerTrackCleanup = (track: MediaStreamTrack) => {
        if (remoteTrackCleanupRef.current.has(track.id)) return;

        const handleEnded = () => {
          removeRemoteTrack(track.id);
        };
        const handleRemoved = (removedEvent: MediaStreamTrackEvent) => {
          if (removedEvent.track.id === track.id) removeRemoteTrack(track.id);
        };

        track.addEventListener('ended', handleEnded, { once: true });
        incomingStream?.addEventListener('removetrack', handleRemoved);
        remoteTrackCleanupRef.current.set(track.id, () => {
          track.removeEventListener('ended', handleEnded);
          incomingStream?.removeEventListener('removetrack', handleRemoved);
        });
      };

      const addTrackIfMissing = (track: MediaStreamTrack) => {
        if (track.readyState === 'ended') return;

        const exists = composite.getTracks().some((existing) => existing.id === track.id);
        if (!exists) {
          if (track.kind === 'video') {
            composite.getVideoTracks().forEach((existing) => {
              composite.removeTrack(existing);
              detachTrackCleanup(existing.id);
            });
          }

          composite.addTrack(track);
          registerTrackCleanup(track);
        }
      };

      if (incomingStream) {
        incomingStream.getTracks().forEach(addTrackIfMissing);
      } else {
        addTrackIfMissing(event.track);
      }

      // Re-emit a fresh stream so the video element updates when tracks arrive later.
      const mergedStream = new MediaStream(composite.getTracks());
      remoteStreamRef.current = mergedStream;
      setRemoteStream(mergedStream);
      onStreamReady?.(mergedStream);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (peerConnectionRef.current !== pc) return;
      if (event.candidate) {
        const targetId = hostPeerIdRef.current;
        void sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
          senderId: participantId,
          ...(targetId ? { targetId } : {}),
          timestamp: Date.now(),
        });
      }
    };

    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
      if (peerConnectionRef.current !== pc) return;
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
          // Re-apply mic priority now that negotiation is done. Some stacks
          // report no encodings on a sender until then, which would have made
          // the call made at addTrack() time a silent no-op.
          for (const sender of pc.getSenders()) {
            if (sender.track?.kind === 'audio') {
              void prioritizeAudioSender(sender);
            }
          }
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
          remoteStreamRef.current = null;
          remoteTrackCleanupRef.current.forEach((cleanup) => {
            cleanup();
          });
          remoteTrackCleanupRef.current.clear();
          setRemoteStream(null);
          onStreamEnded?.();
          break;
      }
    };

    // Handle connection state (overall)
    pc.onconnectionstatechange = () => {
      if (peerConnectionRef.current !== pc) return;
      const handler = handleConnectionFailureRef.current;
      if (pc.connectionState === 'failed' && handler) {
        void handler();
      }
    };

    // Handle incoming data channel from host
    pc.ondatachannel = (event) => {
      if (peerConnectionRef.current !== pc) return;
      setupDataChannel(event.channel);
    };

    return pc;
  }, [
    participantId,
    onStreamReady,
    onStreamEnded,
    removeRemoteTrack,
    setupDataChannel,
    sendSignal,
  ]);

  // Disconnect
  const disconnect = useCallback(() => {
    // Stop stats collection
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    // Close data channel
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop mic tracks
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      micStreamRef.current = null;
    }

    // Unsubscribe from channel
    if (channelRef.current) {
      void channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    remoteStreamRef.current = null;
    remoteTrackCleanupRef.current.forEach((cleanup) => {
      cleanup();
    });
    remoteTrackCleanupRef.current.clear();
    hostPeerIdRef.current = null;
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
    setConnectionState('disconnected');
    setQualityMetrics(null);
    setDataChannelReady(false);
    setControlState('view-only');
    setMicEnabled(false);
    setHasMic(false);
  }, []);

  // Keep disconnect ref updated for use in data channel handler
  disconnectRef.current = disconnect;

  // Toggle microphone
  const toggleMic = useCallback(() => {
    const micStream = micStreamRef.current;
    if (!micStream) return;

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) return;

    const newEnabled = !micEnabled;
    tracks.forEach((track) => {
      track.enabled = newEnabled;
    });
    setMicEnabled(newEnabled);
  }, [micEnabled]);

  // Initialize connection
  const initialize = useCallback(async () => {
    const supabase = createClient();

    // Capture microphone BEFORE setting up the peer connection
    // so mic tracks are available when the SDP answer is created
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: VOICE_AUDIO_CONSTRAINTS,
        video: false,
      });
      markTrackAsSpeech(micStream.getAudioTracks()[0]);
      micStreamRef.current = micStream;
      setHasMic(true);
      setMicEnabled(true);
      console.log('[WebRTC] Microphone captured for viewer audio');
    } catch (err: unknown) {
      console.warn('[WebRTC] Could not access microphone, joining without audio:', err);
      micStreamRef.current = null;
      setHasMic(false);
      setMicEnabled(false);
    }

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
          handleSignalMessage(message);
        }
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('connecting');

          // Create peer connection
          const pc = createPeerConnection();
          peerConnectionRef.current = pc;

          // Add mic tracks to peer connection so they're included in the SDP answer
          const micStream = micStreamRef.current;
          if (micStream) {
            micStream.getAudioTracks().forEach((track) => {
              void prioritizeAudioSender(pc.addTrack(track, micStream));
            });
          }

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
    // Remote control
    controlState,
    dataChannelReady,
    requestControl,
    releaseControl,
    sendInput,
    // Microphone
    micEnabled,
    hasMic,
    toggleMic,
  };
}
