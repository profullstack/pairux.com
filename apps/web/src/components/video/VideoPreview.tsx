'use client';

import { useRef, useEffect } from 'react';
import { Monitor, StopCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CaptureState } from '@/hooks/useScreenCapture';

interface VideoPreviewProps {
  stream: MediaStream | null;
  captureState: CaptureState;
  error: string | null;
  onStartCapture: () => void;
  onStopCapture: () => void;
  className?: string;
}

export function VideoPreview({
  stream,
  captureState,
  error,
  onStartCapture,
  onStopCapture,
  className = '',
}: VideoPreviewProps) {
  const t = useTranslations('video.preview');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch((err: unknown) => {
        console.error('Failed to play preview:', err);
      });
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  const isActive = captureState === 'active' && stream !== null;

  return (
    <div className={`relative bg-black ${className}`}>
      {/* Video preview */}
      {isActive ? (
        <video ref={videoRef} className="h-full w-full object-contain" autoPlay playsInline muted />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center">
          {captureState === 'idle' && (
            <>
              <Monitor className="h-16 w-16 text-gray-600" />
              <p className="mt-4 text-gray-400">{t('idleHint')}</p>
              <button
                type="button"
                onClick={onStartCapture}
                className="bg-primary-600 hover:bg-primary-700 mt-6 rounded-lg px-6 py-3 font-semibold text-white transition-colors"
              >
                {t('start')}
              </button>
            </>
          )}

          {captureState === 'requesting' && (
            <>
              <Monitor className="h-16 w-16 animate-pulse text-blue-500" />
              <p className="mt-4 text-gray-400">{t('requesting')}</p>
              <p className="mt-2 text-sm text-gray-500">{t('selectSource')}</p>
            </>
          )}

          {captureState === 'error' && (
            <>
              <Monitor className="h-16 w-16 text-red-500" />
              <p className="mt-4 text-red-400">{error}</p>
              <button
                type="button"
                onClick={onStartCapture}
                className="bg-primary-600 hover:bg-primary-700 mt-6 rounded-lg px-6 py-3 font-semibold text-white transition-colors"
              >
                {t('tryAgain')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Stop button overlay */}
      {isActive && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/80 to-transparent p-4">
          <button
            type="button"
            onClick={onStopCapture}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-red-700"
          >
            <StopCircle className="h-5 w-5" />
            {t('stop')}
          </button>
        </div>
      )}
    </div>
  );
}
