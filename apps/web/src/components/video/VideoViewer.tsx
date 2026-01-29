'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { QualityIndicator } from './QualityIndicator';
import type { ConnectionState, QualityMetrics, NetworkQuality } from '@pairux/shared-types';

interface VideoViewerProps {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  qualityMetrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
  error: string | null;
  onReconnect?: (() => void) | undefined;
  className?: string;
}

export function VideoViewer({
  stream,
  connectionState,
  qualityMetrics,
  networkQuality,
  error,
  onReconnect,
  className = '',
}: VideoViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Attach stream to video element
  // On iOS Safari, unmuted autoplay is blocked. We try unmuted first, and if
  // that fails we fall back to muted playback + a "Tap for audio" overlay.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.muted = false;
      video
        .play()
        .then(() => {
          setIsMuted(false);
          setNeedsAudioGesture(false);
        })
        .catch(() => {
          // Unmuted play blocked (iOS) — retry muted
          video.muted = true;
          setIsMuted(true);
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
  }, [stream]);

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
      setIsMuted(video.muted);
      setNeedsAudioGesture(false);
    }
  }, []);

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

  const isStreaming = connectionState === 'connected' && stream !== null;

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
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-lg bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>

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
