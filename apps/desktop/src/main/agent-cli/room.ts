/**
 * `pairux room`: a link to a fresh anonymous, end-to-end encrypted room.
 *
 *   https://pairux.com/r/<room>#k=<key>
 *
 * Made entirely on this computer: <room> is 128 random bits and <key> is the
 * 32-byte media key in the URL fragment, which browsers never send to PairUX.
 * Anyone with the link can join; no account and no server round trip. Mirrors
 * apps/web/src/lib/anon-rooms.ts, which serves the page.
 */
const toBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newRoomLink(apiUrl: string): string {
  const room = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const key = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return `${apiUrl.replace(/\/$/, '')}/r/${room}#k=${key}`;
}
