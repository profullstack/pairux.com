'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Maximize2, Minimize2, Volume2, VolumeX, Mic } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { QualityIndicator } from './QualityIndicator';
import type { ConnectionState, QualityMetrics, NetworkQuality } from '@pairux/shared-types';
import { DEFAULT_REMOTE_AUDIO_GAIN } from '@pairux/shared-types';
import { amplifyRemoteAudioTracks, type AmplifiedAudioTrack } from '@/lib/remoteAudioGain';

interface VideoViewerProps {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  error: string | null;
  onReconnect?: (() => void) | undefined;
  speakerMuted?: boolean | undefined;
  onSpeakerMutedChange?: ((muted: boolean) => void) | undefined;
  showSpeakerToggle?: boolean | undefined;
  /** Playback gain for the remote audio. Above 1.0 makes a quiet talker louder. */
  speakerGain?: number | undefined;
  className?: string;
}

export function VideoViewer({
  stream,
  connectionState,
  qualityMetrics,
  networkQuality,
  error,
  onReconnect,
  speakerMuted,
  onSpeakerMutedChange,
  showSpeakerToggle = true,
  speakerGain = DEFAULT_REMOTE_AUDIO_GAIN,
  className = '',
}: VideoViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const isMuted = speakerMuted ?? localMuted;
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasVideoTrack = !!stream && stream.getVideoTracks().length > 0;
  const hasAudioTrack = !!stream && stream.getAudioTracks().length > 0;

  // The <video> element caps volume at 1.0, so the remote audio is routed
  // through a gain stage and swapped back into the stream before playback.
  // Video tracks pass through untouched.
  const amplifiedRef = useRef<AmplifiedAudioTrack | null>(null);
  const speakerGainRef = useRef(speakerGain);
  speakerGainRef.current = speakerGain;
  const [playbackStream, setPlaybackStream] = useState<MediaStream | null>(null);
  const remoteAudioTrackIds =
    stream
      ?.getAudioTracks()
      .map((track) => track.id)
      .sort()
      .join('\0') ?? null;

  useEffect(() => {
    if (!stream) {
      setPlaybackStream(null);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      // Screen-share only — nothing to amplify.
      setPlaybackStream(stream);
      return;
    }

    const amplified = amplifyRemoteAudioTracks(audioTracks, speakerGainRef.current);
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
      if (amplifiedRef.current === amplified) {
        amplifiedRef.current = null;
      }
    };
    // Rebuild when any underlying audio track changes, which renegotiation can
    // do without changing the stream's identity.
  }, [stream, remoteAudioTrackIds]);

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

  // Attach stream to video element
  // On iOS Safari, unmuted autoplay is blocked. We try unmuted first, and if
  // that fails we fall back to muted playback + a "Tap for audio" overlay.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (playbackStream) {
      video.srcObject = playbackStream;
      video.muted = isMuted;
      video
        .play()
        .then(() => {
          setNeedsAudioGesture(false);
        })
        .catch(() => {
          // Unmuted play blocked (iOS) — retry muted
          video.muted = true;
          setMutedState(true);
          video
            .play()
            .then(() => {
              setNeedsAudioGesture(true);
            })
            .catch((err: unknown) => {
              console.error('Failed to play video:', err);
            });
        });
    } else {
      video.srcObject = null;
    }
  }, [playbackStream, isMuted, setMutedState]);

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  // Toggle mute (also clears the iOS audio gesture banner)
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
      setMutedState(video.muted);
      setNeedsAudioGesture(false);
    }
  }, [setMutedState]);

  // Auto-hide controls
  const handleMouseMove = useCallback(() => {
    setShowControls(true);

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    controlsTimeoutRef.current = setTimeout(() => {
      if (connectionState === 'connected') {
        setShowControls(false);
      }
    }, 3000);
  }, [connectionState]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        void toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      } else if (e.key === 'Escape' && isFullscreen) {
        void document.exitFullscreen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleFullscreen, toggleMute, isFullscreen]);

  const isStreaming = connectionState === 'connected' && hasVideoTrack;
  const isVoiceOnly = connectionState === 'connected' && !hasVideoTrack;

  return (
    <div
      ref={containerRef}
      className={`relative bg-black ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (isStreaming) setShowControls(false);
      }}
    >
      {/* Video element — muted state is controlled imperatively for iOS compat */}
      <video ref={videoRef} className="h-full w-full object-contain" autoPlay playsInline />

      {/* Voice-only placeholder: connected but no screen share active */}
      {isVoiceOnly && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/90">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
            <Mic className="h-8 w-8 text-gray-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-gray-300">No screen is being shared</p>
          <p className="mt-1 text-xs text-gray-500">Voice session active</p>
        </div>
      )}

      {/* iOS autoplay: tap to enable audio */}
      {needsAudioGesture && isStreaming && (
        <button
          type="button"
          className="absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white backdrop-blur transition-opacity hover:bg-black/90"
          onClick={toggleMute}
        >
          <span className="flex items-center gap-2">
            <VolumeX className="h-4 w-4" />
            Tap to enable audio
          </span>
        </button>
      )}

      {/* Voice-only speaker toggle */}
      {showSpeakerToggle && isVoiceOnly && hasAudioTrack && (
        <button
          type="button"
          className="absolute top-4 right-4 z-20 rounded-lg bg-black/60 p-2 text-white backdrop-blur transition-colors hover:bg-black/80"
          onClick={toggleMute}
          title={isMuted ? 'Turn speaker on (M)' : 'Turn speaker off (M)'}
        >
          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      )}

      {/* Connection status overlay */}
      <ConnectionStatus connectionState={connectionState} error={error} onReconnect={onReconnect} />

      {/* Controls overlay */}
      {isStreaming && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center justify-between">
            {/* Quality indicator */}
            <QualityIndicator metrics={qualityMetrics} networkQuality={networkQuality} />

            {/* Control buttons */}
            <div className="flex items-center gap-2">
              {/* Mute toggle */}
              {showSpeakerToggle && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-lg bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
              )}

              {/* Fullscreen toggle */}
              <button
                type="button"
                onClick={() => {
                  void toggleFullscreen();
                }}
                className="rounded-lg bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-5 w-5" />
                ) : (
                  <Maximize2 className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
