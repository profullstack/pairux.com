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

const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 640 },
  frameRate: { ideal: 30 },
};

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
      const video: MediaTrackConstraints = { ...CAMERA_CONSTRAINTS };
      if (requestedDeviceId) {
        video.deviceId = { exact: requestedDeviceId };
      }

      const cameraStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
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
      const message = err instanceof Error ? err.message : 'Failed to access camera';
      console.error('[Camera] Failed to enable:', err);
      setError(message);
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
