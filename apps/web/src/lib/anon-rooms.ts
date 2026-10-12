/**
 * Anonymous rooms: an end-to-end encrypted voice/video room that anyone can
 * open from a link, with no PairUX account and nothing stored server side.
 *
 *   https://pairux.com/r/<room>#k=<key>
 *
 * The link is the whole room. <room> is 128+ random bits, so it cannot be
 * guessed; <key> is the 32-byte media key, base64url, in the URL fragment, so
 * browsers never send it to PairUX. Every frame is encrypted in the browser
 * with it (@profullstack/pairux-embed), and the SFU only forwards ciphertext.
 * Apps such as qrypt.chat (`/voice`) mint these links locally and share them
 * over their own encrypted channel.
 *
 * LiveKit rooms are `anon-<room>`, which recording, restreaming and call
 * analysis never touch (they only act on `session-*` rooms).
 */

/** At least 22 base64url characters = 128 bits, so a room id cannot be guessed. */
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const ANON_ROOM_MAX_PARTICIPANTS = 16;

export const anonRoomName = (room: string) => `anon-${room}`;

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
      c.charCodeAt(0)
    );
  } catch {
    return null;
  }
}

/** The media key from a location hash (`#k=<base64url>`), or null if absent or too short. */
export function keyFromHash(hash: string): Uint8Array | null {
  const k = new URLSearchParams(hash.replace(/^#/, '')).get('k');
  const key = k ? fromBase64Url(k) : null;
  return key && key.length >= 32 ? key : null;
}

/** A fresh room: a random id, a random 32-byte key, and the link carrying both. */
export function newAnonRoom(origin: string) {
  const room = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const key = crypto.getRandomValues(new Uint8Array(32));
  return { room, key, url: `${origin.replace(/\/$/, '')}/r/${room}#k=${toBase64Url(key)}` };
}

/** LiveKit's server API speaks HTTP(S) at the same host as the wss:// client URL. */
export const liveKitServiceUrl = (url: string) =>
  url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
