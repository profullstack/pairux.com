/**
 * Hook for managing RTMP live streaming in the renderer process
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getElectronAPI, isElectron } from '@/lib/ipc';
import { isLiveStreamEnabled } from '@/lib/liveStream';
import { API_BASE_URL } from '../../shared/config';

const LIVE_STREAM_DISABLED_MESSAGE = 'Live streaming is turned off in Settings';
import type {
  RTMPDestinationInfo,
  RTMPStreamState,
  StreamPlatform,
  StreamStatus,
  EncoderSettings,
} from '../../preload/api';

export const DEFAULT_ENCODER_SETTINGS: EncoderSettings = {
  videoBitrate: 4500,
  resolution: '1080p',
  framerate: 30,
  keyframeInterval: 2,
  audioBitrate: 128,
};

export const PLATFORM_DEFAULTS: Record<
  StreamPlatform,
  { name: string; rtmpUrl: string; encoderSettings: Partial<EncoderSettings> }
> = {
  // Bitrate defaults assume multi-destination streaming: every enabled
  // destination adds its own sustained upload, and a saturated uplink kills
  // ALL streams (and the app's own API calls). 3500k x2 fits a ~10 Mbps
  // uplink with headroom; users with fat pipes can raise per destination.
  youtube: {
    name: 'YouTube',
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    encoderSettings: { videoBitrate: 3500, framerate: 30 },
  },
  twitch: {
    name: 'Twitch',
    rtmpUrl: 'rtmp://live.twitch.tv/app',
    encoderSettings: { videoBitrate: 3500, framerate: 30 },
  },
  facebook: {
    name: 'Facebook',
    rtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    encoderSettings: { videoBitrate: 4000, framerate: 30 },
  },
  custom: {
    name: 'Custom RTMP',
    rtmpUrl: '',
    encoderSettings: {},
  },
};

interface UseRTMPStreamingOptions {
  onStreamStarted?: (destinationId: string) => void;
  onStreamStopped?: (destinationId: string) => void;
  onStreamError?: (destinationId: string, error: string) => void;
  onStatusChanged?: (destinationId: string, status: StreamStatus) => void;
}

export function useRTMPStreaming(options: UseRTMPStreamingOptions = {}) {
  const { onStreamStarted, onStreamStopped, onStreamError, onStatusChanged } = options;

  const [destinations, setDestinations] = useState<RTMPDestinationInfo[]>([]);
  const [streamStatuses, setStreamStatuses] = useState<Map<string, RTMPStreamState>>(new Map());
  const [streamWarnings, setStreamWarnings] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Destination Management ---

  const loadDestinations = useCallback(async () => {
    if (!isElectron()) return;
    try {
      setIsLoading(true);
      const dests = await getElectronAPI().invoke('rtmp:getDestinations', undefined);
      setDestinations(dests);
    } catch (err) {
      console.error('[useRTMPStreaming] Failed to load destinations:', err);
      setError('Failed to load streaming destinations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addDestination = useCallback(
    async (dest: Omit<RTMPDestinationInfo, 'id' | 'streamKeyId'>, streamKey: string) => {
      if (!isElectron()) return;
      const newDest = await getElectronAPI().invoke('rtmp:addDestination', {
        destination: dest,
        streamKey,
      });
      setDestinations((prev) => [...prev, newDest]);
    },
    []
  );

  const updateDestination = useCallback(
    async (
      id: string,
      updates: Partial<Omit<RTMPDestinationInfo, 'id' | 'streamKeyId'>>,
      newStreamKey?: string
    ) => {
      if (!isElectron()) return;
      const updated = await getElectronAPI().invoke('rtmp:updateDestination', {
        id,
        updates,
        newStreamKey,
      });
      if (updated) {
        setDestinations((prev) => prev.map((d) => (d.id === id ? updated : d)));
      }
    },
    []
  );

  const removeDestination = useCallback(async (id: string) => {
    if (!isElectron()) return;
    const removed = await getElectronAPI().invoke('rtmp:removeDestination', { id });
    if (removed) {
      setDestinations((prev) => prev.filter((d) => d.id !== id));
    }
  }, []);

  // --- MediaRecorder for streaming ---

  const startMediaCapture = useCallback((stream: MediaStream) => {
    if (mediaRecorderRef.current) return;

    // RTMP targets (YouTube/Twitch) require an audio track. A screen-share
    // without system/mic audio would otherwise produce a video-only stream that
    // the platform silently refuses to make live — mix in a silent track.
    let captureStream = stream;
    if (stream.getAudioTracks().length === 0) {
      try {
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(dest);
        oscillator.start();
        audioContextRef.current = ctx;
        captureStream = new MediaStream([
          ...stream.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ]);
      } catch (err) {
        console.warn('[useRTMPStreaming] Could not add silent audio track:', err);
      }
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const mediaRecorder = new MediaRecorder(captureStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && isElectron()) {
        // Await the write so ffmpeg stdin backpressure throttles us instead of
        // buffering encoded chunks in memory when the upstream network is slow.
        void event.data.arrayBuffer().then(async (buffer) => {
          await getElectronAPI().invoke('rtmp:writeChunk', buffer);
        });
      }
    };

    // Short timeslice so encoded data reaches ffmpeg in a steady trickle rather
    // than 1-second bursts — burstier delivery shows up at the RTMP ingest as
    // gaps and triggers platform "not enough video" buffering warnings.
    mediaRecorder.start(250);
    mediaRecorderRef.current = mediaRecorder;
  }, []);

  const stopMediaCapture = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {
        // ignore
      });
      audioContextRef.current = null;
    }
  }, []);

  // --- Stream Control ---

  const startStream = useCallback(
    async (
      destinationId: string,
      stream: MediaStream
    ): Promise<{ success: boolean; error?: string }> => {
      if (!isElectron()) return { success: false, error: 'Not in Electron' };
      if (!isLiveStreamEnabled()) {
        return { success: false, error: LIVE_STREAM_DISABLED_MESSAGE };
      }

      if (!mediaRecorderRef.current) {
        startMediaCapture(stream);
      }

      const result = await getElectronAPI().invoke('rtmp:startStream', { destinationId });
      if (result.success) {
        onStreamStarted?.(destinationId);
      }
      return result;
    },
    [startMediaCapture, onStreamStarted]
  );

  const stopStream = useCallback(
    async (destinationId: string): Promise<{ success: boolean; error?: string }> => {
      if (!isElectron()) return { success: false, error: 'Not in Electron' };

      const result = await getElectronAPI().invoke('rtmp:stopStream', { destinationId });

      // Check if any streams are still active
      const statuses = (await getElectronAPI().invoke(
        'rtmp:getStatus',
        undefined
      )) as RTMPStreamState[];
      const anyActive = statuses.some(
        (s) => s.status === 'live' || s.status === 'connecting' || s.status === 'reconnecting'
      );
      if (!anyActive) {
        stopMediaCapture();
      }

      if (result.success) {
        onStreamStopped?.(destinationId);
      }
      return result;
    },
    [stopMediaCapture, onStreamStopped]
  );

  const startAllStreams = useCallback(
    async (stream: MediaStream) => {
      if (!isElectron()) return { success: false, started: 0, errors: ['Not in Electron'] };
      if (!isLiveStreamEnabled()) {
        return { success: false, started: 0, errors: [LIVE_STREAM_DISABLED_MESSAGE] };
      }

      if (!mediaRecorderRef.current) {
        startMediaCapture(stream);
      }

      return getElectronAPI().invoke('rtmp:startAll', undefined);
    },
    [startMediaCapture]
  );

  const stopAllStreams = useCallback(async () => {
    if (!isElectron()) return { success: false, stopped: 0 };

    const result = await getElectronAPI().invoke('rtmp:stopAll', undefined);
    stopMediaCapture();
    return result;
  }, [stopMediaCapture]);

  // --- Server-side restreaming (LiveKit egress) ---
  // The server composites the SFU room and fans out to every destination, so
  // the host's uplink only carries their WebRTC publish. Free on all plans.

  // One egress id per destination (server starts an independent egress each).
  const [serverEgressIds, setServerEgressIds] = useState<string[]>([]);

  const startServerStream = useCallback(
    async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      if (!isElectron()) return { success: false, error: 'Not in Electron' };
      if (!isLiveStreamEnabled()) {
        return { success: false, error: LIVE_STREAM_DISABLED_MESSAGE };
      }

      const urls = await getElectronAPI().invoke('rtmp:getServerStreamUrls', undefined);
      if (urls.length === 0) {
        return { success: false, error: 'No enabled destinations with stream keys' };
      }

      const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
      if (!token) {
        return { success: false, error: 'Sign in to stream via the server' };
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/stream/egress/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionId, rtmpUrls: urls }),
        });
        const json = (await response.json().catch(() => ({}))) as {
          data?: { egressId?: string; egressIds?: string[] };
          error?: string;
        };
        const ids = json.data?.egressIds ?? (json.data?.egressId ? [json.data.egressId] : []);
        if (!response.ok || ids.length === 0) {
          return { success: false, error: json.error ?? 'Server streaming failed to start' };
        }
        setServerEgressIds(ids);
        return { success: true };
      } catch {
        return { success: false, error: 'Could not reach the streaming server' };
      }
    },
    []
  );

  const stopServerStream = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    if (!isElectron() || serverEgressIds.length === 0)
      return { success: false, error: 'Not streaming' };
    const { token } = await getElectronAPI().invoke('auth:getToken', undefined);
    if (!token) return { success: false, error: 'Not signed in' };

    try {
      const response = await fetch(`${API_BASE_URL}/api/stream/egress/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ egressIds: serverEgressIds }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        return { success: false, error: json.error ?? 'Failed to stop server stream' };
      }
      setServerEgressIds([]);
      return { success: true };
    } catch {
      return { success: false, error: 'Could not reach the streaming server' };
    }
  }, [serverEgressIds]);

  // --- Status Polling ---

  const pollStatuses = useCallback(async () => {
    if (!isElectron()) return;
    try {
      const statuses = (await getElectronAPI().invoke(
        'rtmp:getStatus',
        undefined
      )) as RTMPStreamState[];
      const statusMap = new Map<string, RTMPStreamState>();
      for (const s of statuses) {
        statusMap.set(s.destinationId, s);
      }
      setStreamStatuses(statusMap);
    } catch {
      // ignore polling errors
    }
  }, []);

  // --- Event Subscriptions ---

  useEffect(() => {
    if (!isElectron()) return;

    const api = getElectronAPI();

    const unsubStatus = api.on(
      'rtmp:streamStatusChanged',
      (data: { destinationId: string; status: StreamStatus; error?: string }) => {
        setStreamStatuses((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.destinationId);
          if (existing) {
            next.set(data.destinationId, {
              ...existing,
              status: data.status,
              error: data.error ?? null,
            });
          } else {
            next.set(data.destinationId, {
              destinationId: data.destinationId,
              status: data.status,
              startTime: Date.now(),
              duration: 0,
              bitrate: 0,
              fps: 0,
              reconnectAttempts: 0,
              error: data.error ?? null,
            });
          }
          return next;
        });
        onStatusChanged?.(data.destinationId, data.status);
      }
    );

    const unsubError = api.on(
      'rtmp:streamError',
      (data: { destinationId: string; error: string }) => {
        onStreamError?.(data.destinationId, data.error);
      }
    );

    const unsubWarning = api.on(
      'rtmp:streamWarning',
      (data: { destinationId: string; warning: string | null }) => {
        setStreamWarnings((prev) => {
          const next = new Map(prev);
          if (data.warning === null) {
            next.delete(data.destinationId);
          } else {
            next.set(data.destinationId, data.warning);
          }
          return next;
        });
      }
    );

    return () => {
      unsubStatus();
      unsubError();
      unsubWarning();
    };
  }, [onStatusChanged, onStreamError]);

  // Start/stop status polling when any stream is active
  useEffect(() => {
    const hasActiveStream = Array.from(streamStatuses.values()).some(
      (s) => s.status === 'live' || s.status === 'connecting' || s.status === 'reconnecting'
    );

    if (hasActiveStream && !statusPollRef.current) {
      statusPollRef.current = setInterval(() => void pollStatuses(), 2000);
    } else if (!hasActiveStream && statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }

    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    };
  }, [streamStatuses, pollStatuses]);

  // Load destinations on mount
  useEffect(() => {
    void loadDestinations();
  }, [loadDestinations]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMediaCapture();
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, [stopMediaCapture]);

  // --- Computed ---
  const activeStreamCount = Array.from(streamStatuses.values()).filter(
    (s) => s.status === 'live'
  ).length;
  // "Streaming" includes in-progress states so the UI shows status/stop controls
  // (not a misleading "Go Live") the moment a stream is connecting.
  const isAnyStreaming = Array.from(streamStatuses.values()).some(
    (s) => s.status === 'live' || s.status === 'connecting' || s.status === 'reconnecting'
  );

  return {
    destinations,
    streamStatuses,
    streamWarnings,
    isLoading,
    error,
    activeStreamCount,
    isAnyStreaming,

    addDestination,
    updateDestination,
    removeDestination,
    loadDestinations,

    startStream,
    stopStream,
    startAllStreams,
    stopAllStreams,

    isServerStreaming: serverEgressIds.length > 0,
    startServerStream,
    stopServerStream,
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
