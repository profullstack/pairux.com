import type { CaptureSource } from '@pairux/shared-types';

/**
 * IPC Channel definitions for type-safe communication between
 * main process and renderer.
 */

export type DisplayServer = 'x11' | 'wayland' | 'windows' | 'macos';

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
