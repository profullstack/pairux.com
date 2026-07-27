# Remote start over Tailscale (`pairux --daemon`)

Leave a laptop presenting and drive it from your phone: start and stop the
session from the PairUX web app, wherever you are.

## Why Tailscale

The web app is served over HTTPS, and a browser refuses to call a plain-HTTP
address from an HTTPS page. So the device needs a real certificate, and it needs
some way to know that the person telling it to share a screen is you.

`tailscale serve` provides both:

- a certificate at `https://<device>.<tailnet>.ts.net`, so the PWA can reach it
- caller identity on every proxied request, so authentication comes from your
  tailnet rather than a secret you would have to create and store

The daemon itself listens on loopback only. Without `tailscale serve` in front,
nothing outside the machine can reach it at all.

## Setup

Tailscale is installed for you by `install.sh`, immediately after ffmpeg. If you
installed PairUX another way:

```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
# macOS
brew install tailscale
```

Then, once per machine:

```bash
tailscale up
```

Your tailnet needs **MagicDNS** and **HTTPS certificates** enabled (Tailscale
admin console → DNS). Without them there is no `.ts.net` name to serve on.

## Running it

```bash
pairux --daemon
```

The daemon publishes itself with `tailscale serve` and prints where to point
your phone:

```
[Daemon] Listening on 127.0.0.1:17872
[Daemon] Reachable on your tailnet at https://bonita.tailnet-1234.ts.net
[Daemon] Open pairux.com on your phone and point it at that address.
```

If Tailscale is missing or logged out it says so and keeps running, reachable
only from the machine it is on.

## Wayland: approve capture once

On Wayland, screen capture cannot begin without the desktop portal's picker,
which needs a person at the machine — Electron does not expose the portal's
restore tokens, so this cannot be automated away.

In practice: start `pairux --daemon`, approve the capture prompt **once** at the
laptop, and it holds that grant. From then on your phone starts and stops
sessions against it with no further prompts. Set it up before you walk away.

macOS, Windows and X11 can start capture cold, with no prompt at the device
(macOS needs Screen Recording granted once, in the usual way).

## API

All endpoints require a Tailscale identity, which `tailscale serve` supplies,
and only accept requests from `https://pairux.com`.

| Method | Path             | Purpose                                               |
| ------ | ---------------- | ----------------------------------------------------- |
| `GET`  | `/status`        | Whether this device is sharing, and its join code     |
| `POST` | `/session/start` | Start sharing; returns `{ sessionId, joinCode, url }` |
| `POST` | `/session/stop`  | End the session                                       |

`/session/start` returns the live session if one is already running rather than
starting a second.

## Security

- **Loopback bind.** Unreachable without `tailscale serve` in front.
- **Tailnet identity required.** A request without one is refused; there is no
  password to leak or rotate.
- **Origin locked** to `pairux.com`, so no other website can drive your device
  through your own browser.
- **Withdrawn on exit.** Stopping the daemon takes the `tailscale serve` mapping
  down, so a dead daemon leaves nothing published.

## Troubleshooting

**"Not published to the tailnet"** — run `tailscale status`; if it is not
`Running`, run `tailscale up`. If it is running, check MagicDNS and HTTPS
certificates are enabled for the tailnet.

**Phone cannot reach the URL** — confirm the phone is on the same tailnet
(`tailscale status` on both) and that the `.ts.net` address loads in the phone's
browser directly.

**"Timed out waiting for the session to start"** — on Wayland, the capture
prompt is waiting on the device itself. See the section above.
