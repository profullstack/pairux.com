/**
 * Hook for managing an optional webcam stream (the Loom-style camera bubble).
 *
 * The camera is always OFF by default and fully optional — nothing is captured until
 * the user explicitly enables it, and disabling it stops the device immediately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseCameraResult {
  /** The active webcam stream, or null when the camera is off. */
  stream: MediaStream | null;
  /** Whether the camera is currently enabled. */
  isEnabled: boolean;
  /** True while a getUserMedia request is in flight. */
  isStarting: boolean;
  /** Last error message, if enabling the camera failed. */
  error: string | null;
  /** Available video input devices (populated after the first enable). */
  devices: MediaDeviceInfo[];
  /** The device id currently in use, if any. */
  deviceId: string | null;
  /** Turn the camera on (optionally with a specific device). */
  enable: (deviceId?: string) => Promise<void>;
  /** Turn the camera off and release the device. */
  disable: () => void;
  /** Toggle the camera on/off. */
  toggle: () => Promise<void>;
}

// Request a standard 4:3 capture, not a square — webcams don't capture square
// modes, and asking for one makes Chromium's Linux/V4L2 backend fail to start
// the source ("Could not start video source"). The bubble is cropped in CSS.
const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30 },
};

/** DOMException names worth retrying with looser constraints. */
const RELAXABLE_ERRORS = new Set(['NotReadableError', 'OverconstrainedError', 'AbortError']);

/**
 * Open the camera, falling back to progressively looser constraints when the
 * device can't start the requested format. Permission / not-found errors are
 * thrown immediately since relaxing constraints won't help.
 */
async function openCamera(requestedDeviceId?: string): Promise<MediaStream> {
  const preferred: MediaTrackConstraints = { ...CAMERA_CONSTRAINTS };
  if (requestedDeviceId) {
    preferred.deviceId = { exact: requestedDeviceId };
  }

  const attempts: MediaStreamConstraints[] = [
    { video: preferred, audio: false },
    {
      video: requestedDeviceId ? { deviceId: { exact: requestedDeviceId } } : true,
      audio: false,
    },
    { video: true, audio: false },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : '';
      if (!RELAXABLE_ERRORS.has(name)) {
        throw err;
      }
    }
  }
  throw lastError;
}

/** Map raw getUserMedia failures to a message a user can act on. */
function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotReadableError':
    case 'AbortError':
      return 'Camera could not start — it may be in use by another app. Close anything else using the camera and try again.';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was denied.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No compatible camera was found.';
    default:
      return err instanceof Error ? err.message : 'Failed to access camera';
  }
}

export function useCamera(): UseCameraResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = stream;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    setStream(null);
    setDeviceId(null);
  }, []);

  const enable = useCallback(async (requestedDeviceId?: string) => {
    setError(null);
    setIsStarting(true);

    // Stop any existing stream before switching devices.
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    try {
      const cameraStream = await openCamera(requestedDeviceId);
      streamRef.current = cameraStream;
      setStream(cameraStream);

      const activeDeviceId = cameraStream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
      setDeviceId(requestedDeviceId ?? activeDeviceId);

      // Enumerate devices now that permission has been granted (labels are populated).
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === 'videoinput'));
      } catch {
        // Non-critical — device switching just won't be available.
      }
    } catch (err) {
      console.error('[Camera] Failed to enable:', err);
      setError(describeCameraError(err));
      streamRef.current = null;
      setStream(null);
    } finally {
      setIsStarting(false);
    }
  }, []);

  const disable = useCallback(() => {
    stopStream();
    setError(null);
  }, [stopStream]);

  const toggle = useCallback(async () => {
    if (streamRef.current) {
      disable();
    } else {
      await enable(deviceId ?? undefined);
    }
  }, [disable, enable, deviceId]);

  // Release the device on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    };
  }, []);

  return {
    stream,
    isEnabled: stream !== null,
    isStarting,
    error,
    devices,
    deviceId,
    enable,
    disable,
    toggle,
  };
}
