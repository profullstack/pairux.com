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
import { getPlan } from '../billing/entitlement';
import { isPlatformAllowed, UPGRADE_REQUIRED_MESSAGE } from '../../shared/entitlements';

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

  ipcMain.handle('rtmp:startStream', async (_event, args: { destinationId: string }) => {
    const destinations = getDestinations();
    const dest = destinations.find((d) => d.id === args.destinationId);
    if (!dest) return { success: false, error: 'Destination not found' };

    // Paid multistream gate: free plan can stream to YouTube only.
    const plan = await getPlan();
    if (!isPlatformAllowed(dest.platform, plan)) {
      console.log(`[IPC:Streaming] Blocked ${dest.platform} stream on plan "${plan}"`);
      return { success: false, error: UPGRADE_REQUIRED_MESSAGE, upgradeRequired: true };
    }

    const key = getStreamKey(dest.streamKeyId);
    if (!key) return { success: false, error: 'Stream key not found' };

    return startStream(dest, key);
  });

  ipcMain.handle('rtmp:stopStream', (_event, args: { destinationId: string }) => {
    return stopStream(args.destinationId);
  });

  ipcMain.handle('rtmp:startAll', async () => {
    const enabled = getDestinations().filter((d) => d.enabled);

    // Paid multistream gate: drop platforms the current plan can't stream to.
    const plan = await getPlan();
    const allowed = enabled.filter((d) => isPlatformAllowed(d.platform, plan));
    const blocked = enabled.filter((d) => !isPlatformAllowed(d.platform, plan));

    const keyMap = getDecryptedStreamKeys(allowed);
    const result = startAllStreams(allowed, keyMap);

    if (blocked.length > 0) {
      console.log(
        `[IPC:Streaming] Blocked ${String(blocked.length)} destination(s) on plan "${plan}"`
      );
      return {
        ...result,
        errors: [...result.errors, ...blocked.map((d) => `${d.name}: ${UPGRADE_REQUIRED_MESSAGE}`)],
      };
    }

    return result;
  });

  ipcMain.handle('rtmp:stopAll', () => {
    return stopAllStreams();
  });

  // Awaits the write so stdin backpressure propagates back to the renderer.
  ipcMain.handle('rtmp:writeChunk', async (_event, chunk: ArrayBuffer) => {
    const buffer = Buffer.from(chunk);
    await writeStreamChunk(buffer);
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

  // Full ingest URLs for the server-side restreamer (LiveKit egress): the
  // server fans out to these so the host only uploads their WebRTC publish.
  ipcMain.handle('rtmp:getServerStreamUrls', () => {
    const destinations = getDestinations().filter((d) => d.enabled);
    const keys = getDecryptedStreamKeys(destinations);
    const urls: string[] = [];
    for (const dest of destinations) {
      const key = keys.get(dest.id);
      if (key) {
        urls.push(`${dest.rtmpUrl}/${key}`);
      }
    }
    return urls;
  });

  console.log('[IPC:Streaming] Streaming handlers registered');
}
