/**
 * RTMP destination management with encrypted stream key storage
 */

import { safeStorage, app } from 'electron';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { StreamPlatform, EncoderSettings, RTMPDestinationInfo } from '../../preload/api';

const DESTINATIONS_FILE = 'rtmp-destinations.json';
const STREAM_KEYS_FILE = 'stream-keys.enc';

export const DEFAULT_ENCODER_SETTINGS: EncoderSettings = {
  videoBitrate: 4500,
  resolution: '1080p',
  framerate: 30,
  keyframeInterval: 2,
  audioBitrate: 128,
};

export const PLATFORM_PRESETS: Record<
  StreamPlatform,
  { rtmpUrl: string; encoderSettings: EncoderSettings }
> = {
  youtube: {
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    encoderSettings: { ...DEFAULT_ENCODER_SETTINGS, videoBitrate: 4500, framerate: 30 },
  },
  twitch: {
    rtmpUrl: 'rtmp://live.twitch.tv/app',
    encoderSettings: { ...DEFAULT_ENCODER_SETTINGS, videoBitrate: 6000, framerate: 60 },
  },
  facebook: {
    rtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    encoderSettings: { ...DEFAULT_ENCODER_SETTINGS, videoBitrate: 4000, framerate: 30 },
  },
  custom: {
    rtmpUrl: '',
    encoderSettings: { ...DEFAULT_ENCODER_SETTINGS },
  },
};

function getDestinationsPath(): string {
  return join(app.getPath('userData'), DESTINATIONS_FILE);
}

function getStreamKeysPath(): string {
  return join(app.getPath('userData'), STREAM_KEYS_FILE);
}

// --- Stream Key Encryption ---

type StoredStreamKeys = Record<string, string>;

function loadStreamKeys(): StoredStreamKeys {
  const keysPath = getStreamKeysPath();
  if (!existsSync(keysPath)) return {};

  try {
    const data = readFileSync(keysPath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(data);
      return JSON.parse(decrypted) as StoredStreamKeys;
    }
    return JSON.parse(data.toString()) as StoredStreamKeys;
  } catch (error) {
    console.error('[Streaming] Failed to load stream keys:', error);
    return {};
  }
}

function saveStreamKeys(keys: StoredStreamKeys): void {
  const keysPath = getStreamKeysPath();
  const json = JSON.stringify(keys);

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    writeFileSync(keysPath, encrypted);
  } else {
    console.warn('[Streaming] Encryption not available, storing keys in plain text');
    writeFileSync(keysPath, json);
  }
}

export function storeStreamKey(keyId: string, streamKey: string): void {
  const keys = loadStreamKeys();
  keys[keyId] = streamKey;
  saveStreamKeys(keys);
}

export function getStreamKey(keyId: string): string | null {
  const keys = loadStreamKeys();
  return keys[keyId] ?? null;
}

export function removeStreamKey(keyId: string): void {
  const keys = loadStreamKeys();
  const { [keyId]: _, ...remaining } = keys;
  saveStreamKeys(remaining);
}

export function getDecryptedStreamKeys(destinations: RTMPDestinationInfo[]): Map<string, string> {
  const keys = loadStreamKeys();
  const result = new Map<string, string>();
  for (const dest of destinations) {
    const key = keys[dest.streamKeyId];
    if (key) {
      result.set(dest.id, key);
    }
  }
  return result;
}

// --- Destinations CRUD ---

export function getDestinations(): RTMPDestinationInfo[] {
  const destPath = getDestinationsPath();
  if (!existsSync(destPath)) return [];

  try {
    const data = readFileSync(destPath, 'utf-8');
    return JSON.parse(data) as RTMPDestinationInfo[];
  } catch (error) {
    console.error('[Streaming] Failed to load destinations:', error);
    return [];
  }
}

function saveDestinations(destinations: RTMPDestinationInfo[]): void {
  writeFileSync(getDestinationsPath(), JSON.stringify(destinations, null, 2));
}

export function addDestination(
  destination: Omit<RTMPDestinationInfo, 'id' | 'streamKeyId'>,
  streamKey: string
): RTMPDestinationInfo {
  const id = randomUUID();
  const streamKeyId = randomUUID();

  storeStreamKey(streamKeyId, streamKey);

  const newDest: RTMPDestinationInfo = {
    id,
    streamKeyId,
    ...destination,
  };

  const destinations = getDestinations();
  destinations.push(newDest);
  saveDestinations(destinations);

  console.log(`[Streaming] Added destination: ${newDest.name} (${newDest.platform})`);
  return newDest;
}

export function updateDestination(
  id: string,
  updates: Partial<Omit<RTMPDestinationInfo, 'id' | 'streamKeyId'>>,
  newStreamKey?: string
): RTMPDestinationInfo | null {
  const destinations = getDestinations();
  const index = destinations.findIndex((d) => d.id === id);
  if (index === -1) return null;

  const dest = destinations[index];
  Object.assign(dest, updates);

  if (newStreamKey) {
    storeStreamKey(dest.streamKeyId, newStreamKey);
  }

  saveDestinations(destinations);
  console.log(`[Streaming] Updated destination: ${dest.name}`);
  return dest;
}

export function removeDestination(id: string): boolean {
  const destinations = getDestinations();
  const dest = destinations.find((d) => d.id === id);
  if (!dest) return false;

  removeStreamKey(dest.streamKeyId);
  const filtered = destinations.filter((d) => d.id !== id);
  saveDestinations(filtered);

  console.log(`[Streaming] Removed destination: ${dest.name}`);
  return true;
}
