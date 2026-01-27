/**
 * Hook for managing screen recording in the renderer process
 * Uses MediaRecorder API with IPC to main process for file operations
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecordingQuality = '720p' | '1080p' | '4k';
export type RecordingFormat = 'webm' | 'mp4';

interface RecordingOptions {
  quality?: RecordingQuality;
  format?: RecordingFormat;
  includeAudio?: boolean;
  customPath?: string;
  /** Existing stream to record from (for Wayland/getDisplayMedia captures) */
  existingStream?: MediaStream;
}

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  path: string | null;
  error: string | null;
}

interface UseRecordingOptions {
  onStart?: (path: string) => void;
  onStop?: (path: string, duration: number) => void;
  onError?: (error: string) => void;
  onSpaceWarning?: (availableGb: number) => void;
}

// Quality presets for video constraints (optimized for screen recording with text)
const QUALITY_PRESETS: Record<
  RecordingQuality,
  { width: number; height: number; bitrate: number }
> = {
  '720p': { width: 1280, height: 720, bitrate: 4_000_000 }, // 4 Mbps for crisp 720p
  '1080p': { width: 1920, height: 1080, bitrate: 8_000_000 }, // 8 Mbps for crisp 1080p
  '4k': { width: 3840, height: 2160, bitrate: 20_000_000 }, // 20 Mbps for 4K
};

// Minimum space warning threshold (in bytes) - 500MB
const MIN_SPACE_WARNING = 500 * 1024 * 1024;

export function useRecording(options: UseRecordingOptions = {}) {
  const { onStart, onStop, onError, onSpaceWarning } = options;

  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    path: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spaceCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartRef = useRef<number>(0);

  // Get electron API
  const electronAPI = (
    window as unknown as {
      electronAPI?: {
        invoke: (channel: string, args?: unknown) => Promise<unknown>;
        on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      };
    }
  ).electronAPI;

  // Check available disk space
  const checkDiskSpace = useCallback(async () => {
    if (!electronAPI) return;

    try {
      const result = (await electronAPI.invoke('recording:getAvailableSpace')) as {
        bytes: number;
        gb: number;
      };
      if (result.bytes > 0 && result.bytes < MIN_SPACE_WARNING) {
        onSpaceWarning?.(result.gb);
      }
    } catch (error) {
      console.error('[Recording] Failed to check disk space:', error);
    }
  }, [electronAPI, onSpaceWarning]);

  // Update duration timer
  const updateDuration = useCallback(() => {
    if (!state.isRecording || state.isPaused) return;

    const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
    setState((prev) => ({ ...prev, duration: Math.floor(elapsed / 1000) }));
  }, [state.isRecording, state.isPaused]);

  // Start recording
  const startRecording = useCallback(
    async (
      sourceId: string,
      recordingOptions: RecordingOptions = {}
    ): Promise<{ success: boolean; error?: string }> => {
      if (!electronAPI) {
        return { success: false, error: 'Electron API not available' };
      }

      if (state.isRecording) {
        return { success: false, error: 'Recording already in progress' };
      }

      const {
        quality = '1080p',
        format = 'webm',
        includeAudio = false,
        customPath,
        existingStream,
      } = recordingOptions;

      try {
        // Get video constraints based on quality
        const preset = QUALITY_PRESETS[quality];

        let stream: MediaStream;
        let ownsStream = false;
        let micStream: MediaStream | null = null;

        if (existingStream) {
          // Use existing stream (e.g., from Wayland getDisplayMedia)
          // Apply resolution constraints to ensure standard dimensions
          try {
            await existingStream.getVideoTracks()[0].applyConstraints({
              width: { max: preset.width, ideal: preset.width },
              height: { max: preset.height, ideal: preset.height },
            });
            console.log(
              '[Recording] Applied resolution constraints:',
              preset.width,
              'x',
              preset.height
            );
          } catch (constraintError) {
            console.warn('[Recording] Could not apply resolution constraints:', constraintError);
          }

          stream = existingStream;
          ownsStream = false;

          // If audio is requested, use existing audio tracks if available,
          // otherwise capture a separate microphone stream
          if (includeAudio) {
            const existingAudioTracks = existingStream.getAudioTracks();
            if (existingAudioTracks.length > 0) {
              // Stream already has audio (e.g., mic added during capture for WebRTC streaming)
              console.log('[Recording] Using existing audio tracks from stream');
            } else {
              try {
                micStream = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                  video: false,
                });
                micStreamRef.current = micStream; // Store for cleanup
                // Create a new stream combining video from existing and audio from mic
                const combinedStream = new MediaStream();
                existingStream.getVideoTracks().forEach((track) => {
                  combinedStream.addTrack(track);
                });
                micStream.getAudioTracks().forEach((track) => {
                  combinedStream.addTrack(track);
                });
                stream = combinedStream;
                console.log('[Recording] Added microphone audio to stream');
              } catch (micError) {
                console.warn(
                  '[Recording] Failed to get microphone, recording without audio:',
                  micError
                );
              }
            }
          }
        } else {
          // Get media stream from the source
          // Electron's desktopCapturer requires non-standard mandatory constraints
          const constraints = {
            audio: includeAudio
              ? {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                  },
                }
              : false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                maxWidth: preset.width,
                maxHeight: preset.height,
                maxFrameRate: 30,
              },
            },
          } as MediaStreamConstraints;

          stream = await navigator.mediaDevices.getUserMedia(constraints);
          ownsStream = true;
        }
        streamRef.current = ownsStream ? stream : null; // Only track if we own it

        // Start recording on main process (creates file)
        const startResult = (await electronAPI.invoke('recording:start', {
          customPath,
          format,
        })) as { success: boolean; path?: string; error?: string };

        if (!startResult.success) {
          // Only stop tracks if we created the stream
          if (ownsStream) {
            stream.getTracks().forEach((track) => {
              track.stop();
            });
          }
          return { success: false, error: startResult.error };
        }

        // Determine MIME type based on format
        const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm;codecs=vp9';

        // Create MediaRecorder
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
          videoBitsPerSecond: preset.bitrate,
        });

        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0) {
            const buffer = await event.data.arrayBuffer();
            await electronAPI.invoke('recording:writeChunk', buffer);
          }
        };

        mediaRecorder.onerror = (event) => {
          const err = (event as { error?: { message?: string } }).error;
          const errorMessage: string = err?.message ?? 'Recording error';
          console.error('[Recording] MediaRecorder error:', errorMessage);
          setState((prev) => ({ ...prev, error: errorMessage }));
          onError?.(errorMessage);
        };

        mediaRecorder.onstop = () => {
          // Clean up stream
          streamRef.current?.getTracks().forEach((track) => {
            track.stop();
          });
          streamRef.current = null;
          // Clean up mic stream
          micStreamRef.current?.getTracks().forEach((track) => {
            track.stop();
          });
          micStreamRef.current = null;
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
          path: startResult.path ?? null,
          error: null,
        });

        // Start duration timer
        durationIntervalRef.current = setInterval(updateDuration, 1000);

        // Start disk space monitoring (check every 30 seconds)
        spaceCheckIntervalRef.current = setInterval(() => void checkDiskSpace(), 30000);
        void checkDiskSpace();

        onStart?.(startResult.path ?? '');

        console.log('[Recording] Started:', startResult.path);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start recording';
        console.error('[Recording] Failed to start:', error);
        setState((prev) => ({ ...prev, error: message }));
        onError?.(message);
        return { success: false, error: message };
      }
    },
    [electronAPI, state.isRecording, updateDuration, checkDiskSpace, onStart, onError]
  );

  // Pause recording
  const pauseRecording = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!mediaRecorderRef.current || !state.isRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    if (state.isPaused) {
      return { success: false, error: 'Recording already paused' };
    }

    try {
      mediaRecorderRef.current.pause();
      pauseStartRef.current = Date.now();

      if (electronAPI) {
        await electronAPI.invoke('recording:pause');
      }

      setState((prev) => ({ ...prev, isPaused: true }));
      console.log('[Recording] Paused');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause recording';
      return { success: false, error: message };
    }
  }, [electronAPI, state.isRecording, state.isPaused]);

  // Resume recording
  const resumeRecording = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!mediaRecorderRef.current || !state.isRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    if (!state.isPaused) {
      return { success: false, error: 'Recording is not paused' };
    }

    try {
      mediaRecorderRef.current.resume();
      pausedDurationRef.current += Date.now() - pauseStartRef.current;

      if (electronAPI) {
        await electronAPI.invoke('recording:resume');
      }

      setState((prev) => ({ ...prev, isPaused: false }));
      console.log('[Recording] Resumed');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume recording';
      return { success: false, error: message };
    }
  }, [electronAPI, state.isRecording, state.isPaused]);

  // Stop recording
  const stopRecording = useCallback(async (): Promise<{
    success: boolean;
    path?: string;
    duration?: number;
    error?: string;
  }> => {
    if (!mediaRecorderRef.current || !state.isRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    try {
      // Stop the MediaRecorder
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;

      // Stop timers
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      if (spaceCheckIntervalRef.current) {
        clearInterval(spaceCheckIntervalRef.current);
        spaceCheckIntervalRef.current = null;
      }

      // Stop recording on main process
      let result: { success: boolean; path?: string; duration?: number; error?: string } = {
        success: true,
        path: state.path ?? undefined,
        duration: state.duration,
      };
      if (electronAPI) {
        result = (await electronAPI.invoke('recording:stop')) as typeof result;
      }

      const finalDuration = state.duration;
      const finalPath = result.path ?? state.path ?? '';

      setState({
        isRecording: false,
        isPaused: false,
        duration: 0,
        path: null,
        error: null,
      });

      onStop?.(finalPath, finalDuration);

      console.log('[Recording] Stopped:', finalPath, `Duration: ${String(finalDuration)}s`);
      return { success: true, path: finalPath, duration: finalDuration };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop recording';
      console.error('[Recording] Failed to stop:', error);
      return { success: false, error: message };
    }
  }, [electronAPI, state.isRecording, state.duration, state.path, onStop]);

  // Get recordings directory
  const getRecordingsDirectory = useCallback(async (): Promise<string | null> => {
    if (!electronAPI) return null;

    try {
      const result = (await electronAPI.invoke('recording:getDirectory')) as { path: string };
      return result.path;
    } catch {
      return null;
    }
  }, [electronAPI]);

  // Show save dialog
  const showSaveDialog = useCallback(async (): Promise<string | null> => {
    if (!electronAPI) return null;

    try {
      const result = (await electronAPI.invoke('recording:showSaveDialog')) as {
        path: string | null;
      };
      return result.path;
    } catch {
      return null;
    }
  }, [electronAPI]);

  // Open recordings folder
  const openRecordingsFolder = useCallback(async (): Promise<void> => {
    if (!electronAPI) return;

    try {
      await electronAPI.invoke('recording:openFolder');
    } catch (error) {
      console.error('[Recording] Failed to open folder:', error);
    }
  }, [electronAPI]);

  // Get available disk space
  const getAvailableSpace = useCallback(async (): Promise<{ bytes: number; gb: number } | null> => {
    if (!electronAPI) return null;

    try {
      return (await electronAPI.invoke('recording:getAvailableSpace')) as {
        bytes: number;
        gb: number;
      };
    } catch {
      return null;
    }
  }, [electronAPI]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && state.isRecording) {
        mediaRecorderRef.current.stop();
        streamRef.current?.getTracks().forEach((track) => {
          track.stop();
        });
        micStreamRef.current?.getTracks().forEach((track) => {
          track.stop();
        });
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (spaceCheckIntervalRef.current) {
        clearInterval(spaceCheckIntervalRef.current);
      }
    };
  }, [state.isRecording]);

  return {
    // State
    ...state,

    // Actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,

    // Utilities
    getRecordingsDirectory,
    showSaveDialog,
    openRecordingsFolder,
    getAvailableSpace,
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
