import type {
  CaptureSource,
  Profile,
  Session,
  SessionParticipant,
  ChatMessage,
} from '@pairux/shared-types';

/**
 * IPC Channel definitions for type-safe communication between
 * main process and renderer.
 */

export type DisplayServer = 'x11' | 'wayland' | 'windows' | 'macos';

export interface AuthUser {
  id: string;
  email: string;
}

// Session settings for creation
export interface CreateSessionSettings {
  allowGuestControl?: boolean;
  maxParticipants?: number;
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
      displayServer: DisplayServer;
      isWayland: boolean;
    };
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
    return: Promise<void>;
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
}

// Event channels (main -> renderer)
export interface IPCEvents {
  'capture:sourceChanged': CaptureSource;
  'app:error': { message: string; code?: string };
}

// Type helpers for the API
export type ChannelKey = keyof IPCChannels;
export type EventKey = keyof IPCEvents;

export type InvokeArgs<K extends ChannelKey> = IPCChannels[K]['args'];
export type InvokeReturn<K extends ChannelKey> = IPCChannels[K]['return'];
export type EventData<K extends EventKey> = IPCEvents[K];
