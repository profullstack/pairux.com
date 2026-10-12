import { describe, expect, it } from 'vitest';
import {
  ROOM_ID_RE,
  anonRoomName,
  fromBase64Url,
  keyFromHash,
  liveKitServiceUrl,
  newAnonRoom,
  toBase64Url,
} from './anon-rooms';

describe('anonymous rooms', () => {
  it('mint a 128-bit room id and a 32-byte key carried in the fragment', () => {
    const { room, key, url } = newAnonRoom('https://pairux.com/');
    expect(room).toMatch(ROOM_ID_RE);
    expect(key).toHaveLength(32);
    expect(url).toBe(`https://pairux.com/r/${room}#k=${toBase64Url(key)}`);
    expect(keyFromHash(new URL(url).hash)).toEqual(key);
    expect(newAnonRoom('https://pairux.com').room).not.toBe(room);
  });

  it('round-trip base64url, including bytes that need - and _', () => {
    const bytes = new Uint8Array([251, 255, 191, 0, 1]);
    expect(toBase64Url(bytes)).toBe('-_-_AAE');
    expect(fromBase64Url('-_-_AAE')).toEqual(bytes);
    expect(fromBase64Url('not base64!')).toBeNull();
  });

  it('refuse a missing or short key', () => {
    expect(keyFromHash('')).toBeNull();
    expect(keyFromHash('#k=')).toBeNull();
    expect(keyFromHash(`#k=${toBase64Url(new Uint8Array(16))}`)).toBeNull();
  });

  it('only accept unguessable room ids, in their own LiveKit namespace', () => {
    expect(ROOM_ID_RE.test('short')).toBe(false);
    expect(ROOM_ID_RE.test('a'.repeat(22))).toBe(true);
    expect(ROOM_ID_RE.test('a'.repeat(21) + '/')).toBe(false);
    expect(anonRoomName('abc')).toBe('anon-abc');
  });

  it('derive the LiveKit service URL from the client URL', () => {
    expect(liveKitServiceUrl('wss://sfu.pairux.com')).toBe('https://sfu.pairux.com');
    expect(liveKitServiceUrl('ws://localhost:7880')).toBe('http://localhost:7880');
  });
});
