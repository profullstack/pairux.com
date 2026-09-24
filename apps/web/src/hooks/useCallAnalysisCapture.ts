'use client';

import { useEffect, useRef, useState } from 'react';
import type { CallAnalysisSettings } from '@pairux/shared-types';
import { CallAnalysisCapture, type CaptureStatus } from '@/lib/call-analysis/capture';

/**
 * Runs AI call analysis capture for the host while the call is live, when the
 * session was created with analysis on. Starts on its own as soon as there is
 * call audio (voice or screen share alike), follows the screen share for
 * stills, and finishes when the host leaves.
 */
export function useCallAnalysisCapture({
  sessionId,
  settings,
  audio,
  video,
  active,
}: {
  sessionId: string;
  settings: { analysis?: CallAnalysisSettings | undefined } | null | undefined;
  /** The call's mixed audio (host mic + everyone else). */
  audio: MediaStream | null;
  /** The shared screen, when there is one. */
  video: MediaStream | null;
  /** False once the host has ended or left the call. */
  active: boolean;
}): CaptureStatus | 'off' {
  const enabled = settings?.analysis?.enabled === true;
  const captureRef = useRef<CallAnalysisCapture | null>(null);
  const [status, setStatus] = useState<CaptureStatus>('idle');

  useEffect(() => {
    if (!enabled || !active || !audio || captureRef.current) return;
    const capture = new CallAnalysisCapture({
      apiBase: '',
      sessionId,
      source: 'web',
      onStatus: setStatus,
    });
    captureRef.current = capture;
    void capture.start(audio);
  }, [enabled, active, audio, sessionId]);

  useEffect(() => {
    captureRef.current?.setVideo(video);
  }, [video, status]);

  useEffect(() => {
    if (!active && captureRef.current) void captureRef.current.finish();
  }, [active]);

  // Leaving the page (tab close, navigation) finishes the capture as well.
  useEffect(() => {
    const finish = () => {
      void captureRef.current?.finish();
    };
    window.addEventListener('pagehide', finish);
    return () => {
      window.removeEventListener('pagehide', finish);
      finish();
    };
  }, []);

  return enabled ? status : 'off';
}
