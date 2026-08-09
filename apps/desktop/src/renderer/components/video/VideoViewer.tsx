import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Monitor,
  Loader2,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Mic,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ConnectionState, QualityMetrics, NetworkQuality } from '@pairux/shared-types';
import {
  DEFAULT_REMOTE_AUDIO_GAIN,
  MIN_REMOTE_AUDIO_GAIN,
  MAX_REMOTE_AUDIO_GAIN,
  clampAudioGain,
} from '@pairux/shared-types';
import { amplifyRemoteAudio, type AmplifiedAudioTrack } from '@/lib/remoteAudioGain';

interface VideoViewerProps {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  qualityMetrics?: QualityMetrics | null;
  networkQuality?: NetworkQuality;
  error?: string | null;
  onReconnect?: () => void;
  speakerMuted?: boolean;
  onSpeakerMutedChange?: (muted: boolean) => void;
  showSpeakerToggle?: boolean;
  /**
   * Playback gain for the remote audio. Above 1.0 makes a quiet talker louder.
   * Leave unset to let the viewer manage it with the built-in slider.
   */
  speakerGain?: number;
  onSpeakerGainChange?: (gain: number) => void;
  className?: string;
}

export function VideoViewer({
  stream,
  connectionState,
  error,
  onReconnect,
  speakerMuted,
  onSpeakerMutedChange,
  showSpeakerToggle = true,
  speakerGain: speakerGainProp,
  onSpeakerGainChange,
  className = '',
}: VideoViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [requiresUnmute, setRequiresUnmute] = useState(false);
  const isMuted = speakerMuted ?? localMuted;
  const [localGain, setLocalGain] = useState(DEFAULT_REMOTE_AUDIO_GAIN);
  const speakerGain = speakerGainProp ?? localGain;

  const changeGain = useCallback(
    (next: number) => {
      const clamped = clampAudioGain(next);
      onSpeakerGainChange?.(clamped);
      if (speakerGainProp === undefined) {
        setLocalGain(clamped);
      }
    },
    [onSpeakerGainChange, speakerGainProp]
  );

  // The <video> element caps volume at 1.0, so the remote audio is routed
  // through a gain stage and swapped back into the stream before playback.
  // Video tracks pass through untouched.
  const amplifiedRef = useRef<AmplifiedAudioTrack | null>(null);
  const [playbackStream, setPlaybackStream] = useState<MediaStream | null>(null);
  const remoteAudioTrackId = stream?.getAudioTracks()[0]?.id ?? null;

  useEffect(() => {
    if (!stream) {
      setPlaybackStream(null);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    // The index access is typed non-optional here, but an audio-free stream
    // really does yield undefined — a screen share with no mic attached.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!audioTrack) {
      // Screen-share only — nothing to amplify.
      setPlaybackStream(stream);
      return;
    }

    const amplified = amplifyRemoteAudio(audioTrack, speakerGain);
    amplifiedRef.current = amplified;

    const composed = new MediaStream();
    stream.getVideoTracks().forEach((track) => {
      composed.addTrack(track);
    });
    amplified.stream.getAudioTracks().forEach((track) => {
      composed.addTrack(track);
    });
    setPlaybackStream(composed);

    return () => {
      amplified.dispose();
      amplifiedRef.current = null;
    };
    // Rebuild when the underlying audio track is replaced, which renegotiation
    // can do without changing the stream's identity.
  }, [stream, remoteAudioTrackId, speakerGain]);

  // Adjust an existing graph in place rather than rebuilding it on every nudge
  // of a volume slider.
  useEffect(() => {
    amplifiedRef.current?.setGain(speakerGain);
  }, [speakerGain]);

  const setMutedState = useCallback(
    (muted: boolean) => {
      onSpeakerMutedChange?.(muted);
      if (speakerMuted === undefined) {
        setLocalMuted(muted);
      }
    },
    [onSpeakerMutedChange, speakerMuted]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      console.log('[VideoViewer] loadedmetadata', {
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        muted: video.muted,
      });
    };
    const handlePlaying = () => {
      console.log('[VideoViewer] playing', {
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
        muted: video.muted,
      });
    };
    const handleStalled = () => {
      console.warn('[VideoViewer] stalled');
    };
    const handleWaiting = () => {
      console.warn('[VideoViewer] waiting');
    };
    const handleError = () => {
      console.error('[VideoViewer] media error', video.error);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('stalled', handleStalled);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleError);

    if (playbackStream) {
      setRequiresUnmute(false);
      console.log('[VideoViewer] Attaching stream', {
        streamId: playbackStream.id,
        videoTracks: playbackStream.getVideoTracks().length,
        audioTracks: playbackStream.getAudioTracks().length,
      });
      video.srcObject = playbackStream;
      video.muted = isMuted;
      video
        .play()
        .then(() => {
          setRequiresUnmute(false);
          console.log('[VideoViewer] play() succeeded (unmuted)');
        })
        .catch(() => {
          // Unmuted play blocked — retry muted so the video at least renders
          console.warn('[VideoViewer] Unmuted autoplay blocked, retrying muted');
          video.muted = true;
          setMutedState(true);
          video.play().catch((err: unknown) => {
            console.error('[VideoViewer] Failed to play even muted:', err);
          });
          if (playbackStream.getAudioTracks().length > 0) {
            setRequiresUnmute(true);
          }
        });
    } else {
      setRequiresUnmute(false);
      console.log('[VideoViewer] Clearing stream');
      video.srcObject = null;
    }
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('stalled', handleStalled);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleError);
    };
  }, [playbackStream, isMuted, setMutedState]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setMutedState(video.muted);
    if (!video.muted) {
      setRequiresUnmute(false);
    }
  }, [setMutedState]);

  const hasVideoTrack = Boolean(stream && stream.getVideoTracks().length > 0);
  const hasAudioTrack = Boolean(stream && stream.getAudioTracks().length > 0);
  const isStreaming = hasVideoTrack && connectionState === 'connected';
  const isVoiceOnly = connectionState === 'connected' && !hasVideoTrack;
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const isFailed = connectionState === 'failed';
  const isDisconnected = connectionState === 'disconnected';

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-border bg-black ${className}`}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`h-full w-full object-contain ${isStreaming ? '' : 'hidden'}`}
      />

      {requiresUnmute && hasAudioTrack && (isStreaming || isVoiceOnly) && (
        <div className="absolute bottom-4 right-4 z-20">
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.muted = false;
              void video
                .play()
                .then(() => {
                  setRequiresUnmute(false);
                  console.log('[VideoViewer] Audio unmuted after user gesture');
                })
                .catch((err: unknown) => {
                  console.error('[VideoViewer] Failed to unmute/play after user gesture:', err);
                });
            }}
            className="rounded-full border border-white/20 bg-black/70 px-3 py-2 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
          >
            Unmute audio
          </button>
        </div>
      )}

      {/* Voice-only placeholder: connected but no screen share */}
      {isVoiceOnly && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <Mic className="h-8 w-8 text-gray-400" />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              No screen is being shared
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">Voice session active</p>
          </div>
        </div>
      )}

      {/* Waiting for stream overlay */}
      {!isStreaming && !isVoiceOnly && !isFailed && !isDisconnected && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            {isConnecting ? (
              <>
                <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
                <p className="mt-4 text-sm font-medium text-muted-foreground">
                  {connectionState === 'reconnecting'
                    ? 'Reconnecting to host...'
                    : 'Connecting to host...'}
                </p>
              </>
            ) : (
              <>
                <Monitor className="mx-auto h-16 w-16 text-muted-foreground/30" />
                <p className="mt-4 text-lg font-medium text-muted-foreground">
                  Waiting for host to share screen...
                </p>
                <p className="mt-2 text-sm text-muted-foreground/70">
                  The stream will appear here when ready
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Error / failed overlay */}
      {(isFailed || isDisconnected) && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              {error ?? 'Connection lost'}
            </p>
            {onReconnect && (
              <button
                onClick={onReconnect}
                className="mx-auto mt-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <RefreshCw className="h-4 w-4" />
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}

      {/* Connection status badge */}
      <div className="absolute left-4 top-4">
        <ConnectionBadge connectionState={connectionState} />
      </div>

      {/* Speaker toggle */}
      {showSpeakerToggle && (isStreaming || isVoiceOnly) && hasAudioTrack && (
        <div className="absolute right-4 top-4 flex items-center gap-2 rounded-lg bg-black/70 px-2 py-1.5 text-white">
          <button
            type="button"
            onClick={toggleMute}
            className="rounded p-0.5 transition-colors hover:bg-white/20"
            title={isMuted ? 'Turn speaker on' : 'Turn speaker off'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          {/*
            Goes above 1.0, which the <video> element cannot do on its own —
            this drives the gain stage in front of playback, so a quiet talker
            can be made louder instead of only muted.
          */}
          <input
            type="range"
            min={MIN_REMOTE_AUDIO_GAIN}
            max={MAX_REMOTE_AUDIO_GAIN}
            step={0.1}
            value={speakerGain}
            disabled={isMuted}
            onChange={(event) => {
              changeGain(Number(event.target.value));
            }}
            className="w-20 accent-white disabled:opacity-50"
            aria-label="Volume"
            title="Volume"
          />
        </div>
      )}
    </div>
  );
}

function ConnectionBadge({ connectionState }: { connectionState: ConnectionState }) {
  const config: Record<
    ConnectionState,
    { bg: string; text: string; icon: typeof Wifi; label: string }
  > = {
    idle: { bg: 'bg-black/70', text: 'text-gray-400', icon: WifiOff, label: 'Waiting' },
    connecting: {
      bg: 'bg-blue-900/70',
      text: 'text-blue-400',
      icon: RefreshCw,
      label: 'Connecting',
    },
    connected: { bg: 'bg-green-900/70', text: 'text-green-400', icon: Wifi, label: 'Connected' },
    reconnecting: {
      bg: 'bg-yellow-900/70',
      text: 'text-yellow-400',
      icon: RefreshCw,
      label: 'Reconnecting',
    },
    failed: { bg: 'bg-red-900/70', text: 'text-red-400', icon: WifiOff, label: 'Failed' },
    disconnected: {
      bg: 'bg-black/70',
      text: 'text-gray-400',
      icon: WifiOff,
      label: 'Disconnected',
    },
  };

  const { bg, text, icon: Icon, label } = config[connectionState];
  const isAnimating = connectionState === 'connecting' || connectionState === 'reconnecting';

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${bg} ${text}`}
    >
      <Icon className={`h-3 w-3 ${isAnimating ? 'animate-spin' : ''}`} />
      {label}
    </div>
  );
}
