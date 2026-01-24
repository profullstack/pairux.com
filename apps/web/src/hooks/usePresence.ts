/**
 * Presence hook for tracking participant and host heartbeats
 * Ensures rooms survive host disconnection for SFU mode
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  Session,
  SessionParticipant,
  MediaSession,
  SessionStatusResult,
  SessionMode,
  CaptureSourceInfo,
} from '@pairux/shared-types';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const HOST_HEARTBEAT_INTERVAL = 15_000; // 15 seconds for host (more frequent)

interface UsePresenceOptions {
  sessionId: string;
  isHost?: boolean;
  enabled?: boolean;
  onHostOffline?: () => void;
  onHostOnline?: () => void;
}

interface PresenceState {
  isOnline: boolean;
  lastSeen: Date | null;
  hostOnline: boolean;
  hostLastSeen: Date | null;
}

// Type helper for RPC calls that may not be in the generated types yet
interface RpcResponse<T> {
  data: T | null;
  error: Error | null;
}

export function usePresence({
  sessionId,
  isHost = false,
  enabled = true,
  onHostOffline,
  onHostOnline,
}: UsePresenceOptions) {
  const supabase = createClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hostCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [presenceState, setPresenceState] = useState<PresenceState>({
    isOnline: false,
    lastSeen: null,
    hostOnline: true,
    hostLastSeen: null,
  });
  const wasHostOnlineRef = useRef(true);

  // Send participant heartbeat
  const sendParticipantHeartbeat = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const { error } = (await (supabase.rpc as any)('update_participant_presence', {
        p_session_id: sessionId,
      })) as RpcResponse<SessionParticipant>;

      if (error) {
        console.error('[Presence] Failed to send participant heartbeat:', error);
        return false;
      }

      setPresenceState((prev) => ({
        ...prev,
        isOnline: true,
        lastSeen: new Date(),
      }));
      return true;
    } catch (error) {
      console.error('[Presence] Error sending participant heartbeat:', error);
      return false;
    }
  }, [supabase, sessionId]);

  // Send host heartbeat (more critical)
  const sendHostHeartbeat = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const { error } = (await (supabase.rpc as any)('update_host_presence', {
        p_session_id: sessionId,
      })) as RpcResponse<Session>;

      if (error) {
        console.error('[Presence] Failed to send host heartbeat:', error);
        return false;
      }

      setPresenceState((prev) => ({
        ...prev,
        isOnline: true,
        lastSeen: new Date(),
        hostOnline: true,
        hostLastSeen: new Date(),
      }));
      return true;
    } catch (error) {
      console.error('[Presence] Error sending host heartbeat:', error);
      return false;
    }
  }, [supabase, sessionId]);

  // Check host status (for viewers)
  const checkHostStatus = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const { data, error } = (await (supabase.rpc as any)('get_session_status', {
        p_session_id: sessionId,
      })) as RpcResponse<SessionStatusResult[]>;

      if (error) {
        console.error('[Presence] Failed to check host status:', error);
        return;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result) return;

      const hostOnline = result.host_online;
      const hostLastSeen = result.host_last_seen ? new Date(result.host_last_seen) : null;

      setPresenceState((prev) => ({
        ...prev,
        hostOnline,
        hostLastSeen,
      }));

      // Trigger callbacks on state change
      if (wasHostOnlineRef.current && !hostOnline) {
        console.log('[Presence] Host went offline');
        onHostOffline?.();
      } else if (!wasHostOnlineRef.current && hostOnline) {
        console.log('[Presence] Host came back online');
        onHostOnline?.();
      }

      wasHostOnlineRef.current = hostOnline;
    } catch (error) {
      console.error('[Presence] Error checking host status:', error);
    }
  }, [supabase, sessionId, onHostOffline, onHostOnline]);

  // Start heartbeats
  useEffect(() => {
    if (!enabled || !sessionId) return;

    // Send initial heartbeat immediately
    if (isHost) {
      void sendHostHeartbeat();
    } else {
      void sendParticipantHeartbeat();
      void checkHostStatus();
    }

    // Set up interval for heartbeats
    const interval = isHost ? HOST_HEARTBEAT_INTERVAL : HEARTBEAT_INTERVAL;
    intervalRef.current = setInterval(() => {
      if (isHost) {
        void sendHostHeartbeat();
      } else {
        void sendParticipantHeartbeat();
      }
    }, interval);

    // For viewers, also check host status periodically
    if (!isHost) {
      hostCheckIntervalRef.current = setInterval(() => void checkHostStatus(), HEARTBEAT_INTERVAL);
    }

    // Send heartbeat when window regains focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (isHost) {
          void sendHostHeartbeat();
        } else {
          void sendParticipantHeartbeat();
          void checkHostStatus();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (hostCheckIntervalRef.current) {
        clearInterval(hostCheckIntervalRef.current);
        hostCheckIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, sessionId, isHost, sendHostHeartbeat, sendParticipantHeartbeat, checkHostStatus]);

  // Force send heartbeat (useful before important operations)
  const sendHeartbeat = useCallback(async () => {
    if (isHost) {
      return sendHostHeartbeat();
    }
    return sendParticipantHeartbeat();
  }, [isHost, sendHostHeartbeat, sendParticipantHeartbeat]);

  return {
    ...presenceState,
    sendHeartbeat,
    checkHostStatus,
  };
}

/**
 * Hook for hosts to manage their media session
 */
interface UseMediaSessionOptions {
  sessionId: string;
  mode?: SessionMode;
  captureSource?: CaptureSourceInfo;
}

export function useMediaSession({
  sessionId,
  mode = 'p2p',
  captureSource,
}: UseMediaSessionOptions) {
  const supabase = createClient();
  const [mediaSessionId, setMediaSessionId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  const startMediaSession = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const { data, error } = (await (supabase.rpc as any)('start_media_session', {
        p_room_id: sessionId,
        p_mode: mode,
        p_capture_source: captureSource ?? null,
      })) as RpcResponse<MediaSession>;

      if (error) {
        console.error('[MediaSession] Failed to start:', error);
        return null;
      }

      if (data) {
        setMediaSessionId(data.id);
        setIsActive(true);
        console.log('[MediaSession] Started:', data.id);
      }
      return data;
    } catch (error) {
      console.error('[MediaSession] Error starting:', error);
      return null;
    }
  }, [supabase, sessionId, mode, captureSource]);

  const pauseMediaSession = useCallback(async () => {
    if (!mediaSessionId) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const { data, error } = (await (supabase.rpc as any)('pause_media_session', {
        p_media_session_id: mediaSessionId,
      })) as RpcResponse<MediaSession>;

      if (error) {
        console.error('[MediaSession] Failed to pause:', error);
        return null;
      }

      setIsActive(false);
      console.log('[MediaSession] Paused:', mediaSessionId);
      return data;
    } catch (error) {
      console.error('[MediaSession] Error pausing:', error);
      return null;
    }
  }, [supabase, mediaSessionId]);

  const endMediaSession = useCallback(async () => {
    if (!mediaSessionId) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const { data, error } = (await (supabase.rpc as any)('end_media_session', {
        p_media_session_id: mediaSessionId,
      })) as RpcResponse<MediaSession>;

      if (error) {
        console.error('[MediaSession] Failed to end:', error);
        return null;
      }

      setMediaSessionId(null);
      setIsActive(false);
      console.log('[MediaSession] Ended:', mediaSessionId);
      return data;
    } catch (error) {
      console.error('[MediaSession] Error ending:', error);
      return null;
    }
  }, [supabase, mediaSessionId]);

  // End media session on unmount
  useEffect(() => {
    const currentMediaSessionId = mediaSessionId;
    const currentIsActive = isActive;

    return () => {
      if (currentMediaSessionId && currentIsActive) {
        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
        void (supabase.rpc as any)('end_media_session', {
          p_media_session_id: currentMediaSessionId,
        })
          .then(() => {
            console.log('[MediaSession] Cleaned up on unmount');
          })
          .catch((err: Error) => {
            console.error('[MediaSession] Cleanup error:', err);
          });
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      }
    };
  }, [mediaSessionId, isActive, supabase]);

  return {
    mediaSessionId,
    isActive,
    startMediaSession,
    pauseMediaSession,
    endMediaSession,
  };
}

/**
 * Hook for host transfer functionality
 */
export function useHostTransfer(sessionId: string) {
  const supabase = createClient();

  const transferHost = useCallback(
    async (newHostParticipantId: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
        const { data, error } = (await (supabase.rpc as any)('transfer_host', {
          p_session_id: sessionId,
          p_new_host_participant_id: newHostParticipantId,
        })) as RpcResponse<Session>;

        if (error) {
          console.error('[HostTransfer] Failed:', error);
          return { success: false, error: error.message };
        }

        console.log('[HostTransfer] Success, new host assigned');
        return { success: true, session: data };
      } catch (error) {
        console.error('[HostTransfer] Error:', error);
        return { success: false, error: 'Failed to transfer host' };
      }
    },
    [supabase, sessionId]
  );

  const setBackupHost = useCallback(
    async (participantId: string, isBackup = true) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
        const { data, error } = (await (supabase.rpc as any)('set_backup_host', {
          p_session_id: sessionId,
          p_participant_id: participantId,
          p_is_backup: isBackup,
        })) as RpcResponse<SessionParticipant>;

        if (error) {
          console.error('[HostTransfer] Failed to set backup host:', error);
          return { success: false, error: error.message };
        }

        console.log('[HostTransfer] Backup host set:', participantId);
        return { success: true, participant: data };
      } catch (error) {
        console.error('[HostTransfer] Error setting backup host:', error);
        return { success: false, error: 'Failed to set backup host' };
      }
    },
    [supabase, sessionId]
  );

  return {
    transferHost,
    setBackupHost,
  };
}
