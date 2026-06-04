import type {
  CaptureSource,
  Profile,
  Session,
  SessionParticipant,
  ChatMessage,
  InputEvent,
  SessionMode,
} from '@pairux/shared-types';

/**
 * IPC Channel definitions for type-safe communication between
 * main process and renderer.
 */

export type DisplayServer = 'x11' | 'wayland' | 'windows' | 'macos';

export type TrayStatus = 'idle' | 'active' | 'paused' | 'error';

export interface TraySessionInfo {
  id: string;
  joinCode: string;
  participantCount: number;
  status: 'created' | 'active' | 'paused' | 'ended';
  role: 'host' | 'viewer';
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface InputInjectionDiagnostics {
  enabled: boolean;
  backend: string;
  backendSupported: boolean;
  reason?: string;
  details?: Record<string, unknown>;
  stats: { received: number; injected: number; errors: number };
}

// Session settings for creation
export interface CreateSessionSettings {
  allowGuestControl?: boolean;
  maxParticipants?: number;
  mode?: SessionMode;
}

// Request/response channels (invoke pattern)
export interface IPCChannels {
  // Capture channels
  'capture:getSources': {
    args: { types: ('screen' | 'window')[] };
    return: CaptureSource[];
  };

  // Platform info
  'platform:info': {
    args: undefined;
    return: {
      platform: NodeJS.Platform;
      arch: string;
      version: string;
      appVersion: string;
      displayServer: DisplayServer;
      isWayland: boolean;
      isX11: boolean;
      isElevated: boolean;
      hasScreenCaptureSupport: boolean;
      hasInputInjectionSupport: boolean;
    };
  };

  'platform:toggle-devtools': {
    args: undefined;
    return: { success: boolean; isOpen?: boolean; error?: string };
  };

  // Auth channels
  'auth:login': {
    args: { email: string; password: string };
    return: { success: true; user: AuthUser } | { success: false; error: string };
  };

  'auth:logout': {
    args: undefined;
    return: { success: boolean };
  };

  'auth:getSession': {
    args: undefined;
    return: { user: AuthUser | null; profile: Profile | null };
  };

  'auth:validateSession': {
    args: undefined;
    return: { valid: boolean; user: AuthUser | null };
  };

  'auth:openExternal': {
    args: string;
    return: undefined;
  };

  'auth:getToken': {
    args: undefined;
    return: { token: string | null };
  };

  'auth:setRememberedCredentials': {
    args: { email: string; password: string };
    return: { success: boolean };
  };

  'auth:getRememberedCredentials': {
    args: undefined;
    return: { credentials: { email: string; password: string } | null };
  };

  'auth:clearRememberedCredentials': {
    args: undefined;
    return: { success: boolean };
  };

  // Session channels
  'session:create': {
    args: CreateSessionSettings | undefined;
    return: { success: true; session: Session } | { success: false; error: string };
  };

  'session:end': {
    args: { sessionId: string };
    return: { success: true } | { success: false; error: string };
  };

  'session:get': {
    args: { sessionId: string };
    return:
      | {
          success: true;
          session: Session;
          participants: SessionParticipant[];
        }
      | { success: false; error: string };
  };

  'session:lookup': {
    args: { joinCode: string };
    return:
      | {
          success: true;
          session: {
            id: string;
            join_code: string;
            status: string;
            settings: {
              quality?: string;
              allowControl?: boolean;
              maxParticipants?: number;
            };
            participant_count: number;
          };
        }
      | {
          success: true;
          scheduledSession: {
            id: string;
            join_code: string;
            title: string;
            description: string | null;
            scheduled_at: string;
            duration_minutes: number;
            invitees: { name: string | null; rsvp_status: string }[];
          };
        }
      | { success: false; error: string };
  };

  'session:join': {
    args: { joinCode: string; displayName?: string };
    return: { success: true; participant: SessionParticipant } | { success: false; error: string };
  };

  // Chat channels
  'chat:send': {
    args: { sessionId: string; content: string };
    return: { success: true; message: ChatMessage } | { success: false; error: string };
  };

  'chat:getHistory': {
    args: { sessionId: string; limit?: number; before?: string };
    return:
      | {
          success: true;
          messages: ChatMessage[];
          hasMore: boolean;
        }
      | { success: false; error: string };
  };

  // Input injection channels
  'input:init': {
    args: undefined;
    return: { success: boolean };
  };

  'input:enable': {
    args: undefined;
    return: { success: boolean } & InputInjectionDiagnostics;
  };

  'input:disable': {
    args: undefined;
    return: { success: boolean; enabled: boolean };
  };

  'input:status': {
    args: undefined;
    return: InputInjectionDiagnostics;
  };

  'input:updateScreenSize': {
    args: { width: number; height: number };
    return: { success: boolean };
  };

  'input:inject': {
    args: { event: InputEvent };
    return: { success: boolean };
  };

  'input:injectBatch': {
    args: { events: InputEvent[] };
    return: { success: boolean; count: number };
  };

  'input:emergencyStop': {
    args: undefined;
    return: { success: boolean };
  };

  // Permission channels
  'permissions:status': {
    args: undefined;
    return: { accessibility: boolean; screenCapture: boolean };
  };

  'permissions:requestAccessibility': {
    args: undefined;
    return: { granted: boolean };
  };

  'permissions:requestScreenCapture': {
    args: undefined;
    return: { granted: boolean };
  };

  'permissions:requestAll': {
    args: undefined;
    return: { accessibility: boolean; screenCapture: boolean };
  };

  // Recording channels
  'recording:start': {
    args: { customPath?: string; format?: 'webm' | 'mp4' } | undefined;
    return: { success: boolean; path?: string; error?: string };
  };

  'recording:stop': {
    args: undefined;
    return: { success: boolean; path?: string; duration?: number; error?: string };
  };

  'recording:writeChunk': {
    args: ArrayBuffer;
    return: { success: boolean };
  };

  'recording:status': {
    args: undefined;
    return: { isRecording: boolean; path: string | null; duration: number | null };
  };

  'recording:showSaveDialog': {
    args: undefined;
    return: { path: string | null };
  };

  'recording:getDirectory': {
    args: undefined;
    return: { path: string };
  };

  'recording:getAvailableSpace': {
    args: undefined;
    return: { bytes: number; gb: number };
  };

  'recording:openFolder': {
    args: undefined;
    return: { success: boolean };
  };

  'recording:pause': {
    args: undefined;
    return: { success: boolean };
  };

  'recording:resume': {
    args: undefined;
    return: { success: boolean };
  };

  // Tray channels
  'tray:setSession': {
    args: { session: TraySessionInfo | null };
    return: { success: boolean };
  };

  'tray:setStatus': {
    args: { status: TrayStatus };
    return: { success: boolean };
  };

  'tray:getStatus': {
    args: undefined;
    return: { status: TrayStatus; session: TraySessionInfo | null };
  };

  'tray:copyJoinCode': {
    args: { joinCode: string };
    return: { success: boolean };
  };

  'tray:notify': {
    args: { title: string; content: string };
    return: { success: boolean };
  };

  'tray:flash': {
    args: undefined;
    return: { success: boolean };
  };

  'tray:minimize': {
    args: undefined;
    return: { success: boolean };
  };

  // RTMP Streaming channels
  'rtmp:getDestinations': {
    args: undefined;
    return: RTMPDestinationInfo[];
  };

  'rtmp:addDestination': {
    args: {
      destination: {
        name: string;
        platform: StreamPlatform;
        rtmpUrl: string;
        enabled: boolean;
        encoderSettings: EncoderSettings;
      };
      streamKey: string;
    };
    return: RTMPDestinationInfo;
  };

  'rtmp:updateDestination': {
    args: {
      id: string;
      updates: Partial<{
        name: string;
        platform: StreamPlatform;
        rtmpUrl: string;
        enabled: boolean;
        encoderSettings: EncoderSettings;
      }>;
      newStreamKey?: string;
    };
    return: RTMPDestinationInfo | null;
  };

  'rtmp:removeDestination': {
    args: { id: string };
    return: boolean;
  };

  'rtmp:startStream': {
    args: { destinationId: string };
    return: { success: boolean; error?: string };
  };

  'rtmp:stopStream': {
    args: { destinationId: string };
    return: { success: boolean; error?: string };
  };

  'rtmp:startAll': {
    args: undefined;
    return: { success: boolean; started: number; errors: string[] };
  };

  'rtmp:stopAll': {
    args: undefined;
    return: { success: boolean; stopped: number };
  };

  'rtmp:writeChunk': {
    args: ArrayBuffer;
    return: { success: boolean };
  };

  'rtmp:getStatus': {
    args: { destinationId?: string } | undefined;
    return: RTMPStreamState | RTMPStreamState[];
  };

  'rtmp:getPlatformPreset': {
    args: { platform: StreamPlatform };
    return: { rtmpUrl: string; encoderSettings: EncoderSettings } | null;
  };
}

// Event channels (main -> renderer)
export interface IPCEvents {
  'capture:sourceChanged': CaptureSource;
  'app:error': { message: string; code?: string };
  'input:emergency-stop': undefined;
  'recording:started': { path: string };
  'recording:stopped': { path: string; duration: number };
  'recording:error': { error: string };
  'recording:space-warning': { availableGb: number };
  'tray:end-session': undefined;
  'tray:toggle-pause': undefined;
  navigate: string;

  // RTMP Streaming events
  'rtmp:streamStatusChanged': {
    destinationId: string;
    status: StreamStatus;
    error?: string;
  };
  'rtmp:streamStats': {
    destinationId: string;
    bitrate: number;
    fps: number;
    duration: number;
  };
  'rtmp:streamError': {
    destinationId: string;
    error: string;
    isRecoverable: boolean;
  };
}

// RTMP Streaming types
export type StreamPlatform = 'youtube' | 'twitch' | 'facebook' | 'custom';
export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error' | 'stopped';

export interface EncoderSettings {
  videoBitrate: number;
  resolution: '720p' | '1080p';
  framerate: 30 | 60;
  keyframeInterval: number;
  audioBitrate: number;
}

export interface RTMPDestinationInfo {
  id: string;
  name: string;
  platform: StreamPlatform;
  rtmpUrl: string;
  streamKeyId: string;
  enabled: boolean;
  encoderSettings: EncoderSettings;
}

export interface RTMPStreamState {
  destinationId: string;
  status: StreamStatus;
  startTime: number | null;
  duration: number;
  bitrate: number;
  fps: number;
  reconnectAttempts: number;
  error: string | null;
}

// Type helpers for the API
export type ChannelKey = keyof IPCChannels;
export type EventKey = keyof IPCEvents;

export type InvokeArgs<K extends ChannelKey> = IPCChannels[K]['args'];
export type InvokeReturn<K extends ChannelKey> = IPCChannels[K]['return'];
export type EventData<K extends EventKey> = IPCEvents[K];
