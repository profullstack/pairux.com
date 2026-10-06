# @profullstack/pairux-embed

End-to-end encrypted voice, video and screen sharing for any web app, on [PairUX](https://pairux.com)'s SFU.

Your app supplies the **media key**: 32 random bytes that you share with the other participants over your own encrypted channel. Every audio and video frame is encrypted in the browser before it leaves, so PairUX's servers only ever forward ciphertext and can neither hear nor see the call. If a browser can't encrypt, the library refuses to join rather than falling back to a plaintext call.

```sh
npm install @profullstack/pairux-embed
```

## 1. Your server gets a token

Partner apps get a key (`pux_pk_…`) from PairUX. Keep it on your server and mint a token per user:

```js
const res = await fetch('https://pairux.com/api/v1/partner/token', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.PAIRUX_PARTNER_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ room: conversationId, identity: userId, name: displayName }),
});
const { data } = await res.json(); // { token, url, roomName, iceServers, e2ee: true }
```

Rooms live in your own namespace. PairUX never records, restreams or analyses partner rooms.

## 2. Your client joins, encrypted

```js
import { PairuxCall, mountCall, newMediaKey } from '@profullstack/pairux-embed';

// Whoever starts the call makes the key and sends it to the others over
// YOUR end-to-end encrypted channel (qrypt.chat sends it ML-KEM-1024 encrypted).
const key = newMediaKey();

const call = new PairuxCall({ url: data.url, token: data.token, iceServers: data.iceServers, key });
const ui = mountCall(document.getElementById('call'), call, { onLeave: () => ui.destroy() });
await call.join({ audio: true, video: false });
```

`mountCall` draws participant tiles and the mic, camera, screen and leave controls in plain DOM, with no framework. To theme it, set `--pxe-bg`, `--pxe-tile`, `--pxe-fg`, `--pxe-muted`, `--pxe-accent` and `--pxe-danger` on the container. To build your own UI instead, use `PairuxCall` directly. Its events are `participants`, `track`, `state` and `error`, and its methods are `setMic`, `setCamera`, `setScreen`, `rotateKey` and `leave`.

**The E2EE worker:** by default the library loads `livekit-client/e2ee-worker` with `new Worker(new URL(...), import.meta.url)`, which Vite, webpack 5 and Next.js resolve. If your bundler doesn't, pass `worker`.

## Licence

MIT.
