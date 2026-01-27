/**
 * Hook for managing screen recording in the browser
 * Uses MediaRecorder API to record to memory and download as file
 */

import { useCallback, useRef, useState } from 'react';

export type RecordingQuality = '720p' | '1080p' | '4k';
export type RecordingFormat = 'webm' | 'mp4';

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  error: string | null;
}

interface UseRecordingOptions {
  onStart?: () => void;
  onStop?: (blob: Blob, duration: number) => void;
  onError?: (error: string) => void;
}

// Quality presets for video bitrates
const QUALITY_PRESETS: Record<RecordingQuality, { bitrate: number }> = {
  '720p': { bitrate: 2_500_000 },
  '1080p': { bitrate: 5_000_000 },
  '4k': { bitrate: 12_000_000 },
};

export function useRecording(options: UseRecordingOptions = {}) {
  const { onStart, onStop, onError } = options;

  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartRef = useRef<number>(0);

  // Update duration timer
  const updateDuration = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
    setState((prev) => ({
      ...prev,
      duration: Math.floor(elapsed / 1000),
    }));
  }, []);

  // Start recording from an existing stream
  const startRecording = useCallback(
    (
      stream: MediaStream,
      recordingOptions: { quality?: RecordingQuality; format?: RecordingFormat } = {}
    ): { success: boolean; error?: string } => {
      if (state.isRecording) {
        return { success: false, error: 'Recording already in progress' };
      }

      const { quality = '1080p', format = 'webm' } = recordingOptions;

      try {
        const preset = QUALITY_PRESETS[quality];

        // Determine MIME type based on format
        // Note: MP4 is not widely supported in MediaRecorder, fallback to webm
        let mimeType = 'video/webm;codecs=vp9';
        if (format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
        } else if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }

        // Create MediaRecorder from the existing stream
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: preset.bitrate,
        });

        chunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onerror = (event) => {
          const err = (event as unknown as { error?: { message?: string } }).error;
          const errorMessage: string = err?.message ?? 'Recording error';
          console.error('[Recording] MediaRecorder error:', errorMessage);
          setState((prev) => ({ ...prev, error: errorMessage }));
          onError?.(errorMessage);
        };

        mediaRecorder.onstop = () => {
          // Create blob from chunks
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const finalDuration = Math.floor(
            (Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000
          );
          onStop?.(blob, finalDuration);
        };

        mediaRecorderRef.current = mediaRecorder;

        // Start the MediaRecorder (request data every second)
        mediaRecorder.start(1000);

        // Initialize state
        startTimeRef.current = Date.now();
        pausedDurationRef.current = 0;

        setState({
          isRecording: true,
          isPaused: false,
          duration: 0,
          error: null,
        });

        // Start duration timer
        durationIntervalRef.current = setInterval(updateDuration, 1000);

        onStart?.();

        console.log('[Recording] Started');
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start recording';
        console.error('[Recording] Failed to start:', error);
        setState((prev) => ({ ...prev, error: message }));
        onError?.(message);
        return { success: false, error: message };
      }
    },
    [state.isRecording, updateDuration, onStart, onStop, onError]
  );

  // Pause recording
  const pauseRecording = useCallback((): { success: boolean; error?: string } => {
    if (!mediaRecorderRef.current || !state.isRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    if (state.isPaused) {
      return { success: false, error: 'Recording already paused' };
    }

    try {
      mediaRecorderRef.current.pause();
      pauseStartRef.current = Date.now();

      setState((prev) => ({ ...prev, isPaused: true }));
      console.log('[Recording] Paused');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause recording';
      return { success: false, error: message };
    }
  }, [state.isRecording, state.isPaused]);

  // Resume recording
  const resumeRecording = useCallback((): { success: boolean; error?: string } => {
    if (!mediaRecorderRef.current || !state.isRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    if (!state.isPaused) {
      return { success: false, error: 'Recording is not paused' };
    }

    try {
      mediaRecorderRef.current.resume();
      pausedDurationRef.current += Date.now() - pauseStartRef.current;

      setState((prev) => ({ ...prev, isPaused: false }));
      console.log('[Recording] Resumed');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume recording';
      return { success: false, error: message };
    }
  }, [state.isRecording, state.isPaused]);

  // Stop recording and return the blob
  const stopRecording = useCallback((): {
    success: boolean;
    error?: string;
  } => {
    if (!mediaRecorderRef.current || !state.isRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    try {
      // Stop the MediaRecorder (triggers onstop callback)
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;

      // Stop timers
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      setState({
        isRecording: false,
        isPaused: false,
        duration: 0,
        error: null,
      });

      console.log('[Recording] Stopped');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop recording';
      console.error('[Recording] Failed to stop:', error);
      return { success: false, error: message };
    }
  }, [state.isRecording]);

  // Download the recorded blob as a file
  const downloadRecording = useCallback((blob: Blob, filename?: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `pairux-recording-${String(Date.now())}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return {
    // State
    ...state,

    // Actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,

    // Utilities
    downloadRecording,
  };
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
