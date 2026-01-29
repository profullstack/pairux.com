import { useEffect, useRef } from 'react';
import { Monitor, Loader2, AlertCircle, RefreshCw, Wifi, WifiOff, Mic } from 'lucide-react';
import type { ConnectionState, QualityMetrics, NetworkQuality } from '@pairux/shared-types';

interface VideoViewerProps {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  qualityMetrics?: QualityMetrics | null;
  networkQuality?: NetworkQuality;
  error?: string | null;
  onReconnect?: () => void;
  className?: string;
}

export function VideoViewer({
  stream,
  connectionState,
  error,
  onReconnect,
  className = '',
}: VideoViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch((err: unknown) => {
        console.error('[VideoViewer] Failed to play:', err);
      });
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  const isStreaming = stream !== null && connectionState === 'connected';
  const isVoiceOnly = connectionState === 'connected' && stream === null;
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
