/**
 * IPC handlers for RTMP live streaming
 */

import { ipcMain } from 'electron';
import type { StreamPlatform } from '../../preload/api';
import {
  startStream,
  stopStream,
  stopAllStreams,
  startAllStreams,
  writeStreamChunk,
  getStreamStatus,
  getAllStreamStatuses,
} from '../streaming';
import {
  getDestinations,
  addDestination,
  updateDestination,
  removeDestination,
  getStreamKey,
  getDecryptedStreamKeys,
  PLATFORM_PRESETS,
} from '../streaming/destinations';

export function registerStreamingHandlers(): void {
  console.log('[IPC:Streaming] Registering streaming handlers');

  // --- Destination CRUD ---

  ipcMain.handle('rtmp:getDestinations', () => {
    return getDestinations();
  });

  ipcMain.handle(
    'rtmp:addDestination',
    (
      _event,
      args: {
        destination: {
          name: string;
          platform: StreamPlatform;
          rtmpUrl: string;
          enabled: boolean;
          encoderSettings: {
            videoBitrate: number;
            resolution: '720p' | '1080p';
            framerate: 30 | 60;
            keyframeInterval: number;
            audioBitrate: number;
          };
        };
        streamKey: string;
      }
    ) => {
      return addDestination(args.destination, args.streamKey);
    }
  );

  ipcMain.handle(
    'rtmp:updateDestination',
    (
      _event,
      args: {
        id: string;
        updates: Partial<{
          name: string;
          platform: StreamPlatform;
          rtmpUrl: string;
          enabled: boolean;
          encoderSettings: {
            videoBitrate: number;
            resolution: '720p' | '1080p';
            framerate: 30 | 60;
            keyframeInterval: number;
            audioBitrate: number;
          };
        }>;
        newStreamKey?: string;
      }
    ) => {
      return updateDestination(args.id, args.updates, args.newStreamKey);
    }
  );

  ipcMain.handle('rtmp:removeDestination', (_event, args: { id: string }) => {
    return removeDestination(args.id);
  });

  // --- Stream Control ---

  ipcMain.handle('rtmp:startStream', (_event, args: { destinationId: string }) => {
    const destinations = getDestinations();
    const dest = destinations.find((d) => d.id === args.destinationId);
    if (!dest) return { success: false, error: 'Destination not found' };

    const key = getStreamKey(dest.streamKeyId);
    if (!key) return { success: false, error: 'Stream key not found' };

    return startStream(dest, key);
  });

  ipcMain.handle('rtmp:stopStream', (_event, args: { destinationId: string }) => {
    return stopStream(args.destinationId);
  });

  ipcMain.handle('rtmp:startAll', () => {
    const destinations = getDestinations().filter((d) => d.enabled);
    const keyMap = getDecryptedStreamKeys(destinations);
    return startAllStreams(destinations, keyMap);
  });

  ipcMain.handle('rtmp:stopAll', () => {
    return stopAllStreams();
  });

  ipcMain.handle('rtmp:writeChunk', (_event, chunk: ArrayBuffer) => {
    const buffer = Buffer.from(chunk);
    writeStreamChunk(buffer);
    return { success: true };
  });

  ipcMain.handle('rtmp:getStatus', (_event, args?: { destinationId?: string }) => {
    if (args?.destinationId) {
      return getStreamStatus(args.destinationId);
    }
    return getAllStreamStatuses();
  });

  // --- Platform Presets ---

  ipcMain.handle('rtmp:getPlatformPreset', (_event, args: { platform: StreamPlatform }) => {
    return PLATFORM_PRESETS[args.platform];
  });

  console.log('[IPC:Streaming] Streaming handlers registered');
}
