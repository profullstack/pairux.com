import type { CaptureSource, Profile } from '@pairux/shared-types';

/**
 * IPC Channel definitions for type-safe communication between
 * main process and renderer.
 */

export type DisplayServer = 'x11' | 'wayland' | 'windows' | 'macos';

export interface AuthUser {
  id: string;
  email: string;
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
