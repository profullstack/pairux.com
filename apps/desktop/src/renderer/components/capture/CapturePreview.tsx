import { useEffect, useRef } from 'react';
import { StopCircle, Monitor, AppWindow } from 'lucide-react';
import type { CaptureSource } from '@pairux/shared-types';

interface CapturePreviewProps {
  stream: MediaStream;
  source: CaptureSource | null;
  onStop: () => void;
}

export function CapturePreview({ stream, source, onStop }: CapturePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
    }

    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  const isScreen = source?.type === 'screen';

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isScreen ? (
            <Monitor className="h-5 w-5 text-primary" />
          ) : (
            <AppWindow className="h-5 w-5 text-primary" />
          )}
          <div>
            <h2 className="text-lg font-semibold">{source?.name ?? 'Capturing'}</h2>
            <p className="text-sm text-muted-foreground">
              {isScreen ? 'Screen' : 'Window'} capture active
            </p>
          </div>
        </div>

        <button
          onClick={onStop}
          className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
        >
          <StopCircle className="h-4 w-4" />
          Stop Sharing
        </button>
      </div>

      {/* Video preview */}
      <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />

        {/* Live indicator */}
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs font-medium text-white">PREVIEW</span>
        </div>
      </div>

      {/* Info bar */}
      <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Ready to share. Connect viewers to start streaming.
        </span>
        <span className="font-mono text-muted-foreground">
          {stream.getVideoTracks()[0]?.getSettings().width ?? 0} x{' '}
          {stream.getVideoTracks()[0]?.getSettings().height ?? 0}
        </span>
      </div>
    </div>
  );
}
