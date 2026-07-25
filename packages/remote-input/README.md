# @profullstack/remote-input

Cross-platform OS input injection for remote control. One normalized event shape
in, real cursor movement and keystrokes out — on macOS, Windows, Linux/X11 and
Linux/Wayland.

Extracted from [PairUX](https://pairux.com), where it drives "let this
participant control my screen" in a WebRTC screen-sharing session.

## Why

Every remote-control feature needs the same unglamorous layer: figure out which
OS input API is even available, convert viewport-relative coordinates into
absolute pixels, map browser key codes onto OS key codes, and make sure a remote
peer cannot lock your machine or flood your event loop. Wayland makes this
sharply worse — it refuses synthetic input from ordinary clients, so the X11
approach simply does not work there.

This package is that layer, with no Electron or GUI-toolkit dependency, so it
runs in a desktop app, a CLI agent, or a headless daemon.

## Install

```sh
pnpm add @profullstack/remote-input
# For macOS / Windows / Linux-X11 injection, also install the optional peer:
pnpm add @nut-tree-fork/nut-js
```

`@nut-tree-fork/nut-js` is an optional peer dependency: it ships native binaries,
so it is not required to install this package or to use the Wayland backends.

## Usage

```ts
import { RemoteInputInjector } from '@profullstack/remote-input';

const injector = new RemoteInputInjector({
  onRejected: (reason, event, detail) => console.warn('refused', reason, detail),
});

await injector.init();

// Nothing is injected until you explicitly enable it. `false` means this host
// cannot inject at all — show the reason instead of pretending control works.
if (!injector.enable()) {
  console.error(injector.getDiagnostics().reason);
}

// Tell it the size of the surface the viewer is looking at, so normalized
// coordinates land on the right pixel.
injector.updateScreenSize(2560, 1440);

await injector.inject({ type: 'mouse', action: 'move', x: 0.5, y: 0.5 });
await injector.inject({
  type: 'keyboard',
  action: 'press',
  key: 'a',
  code: 'KeyA',
  modifiers: { ctrl: false, alt: false, shift: false, meta: false },
});

// On disconnect or a panic hotkey: stop accepting input and release anything
// the remote peer was still holding down.
await injector.emergencyStop();
```

### Coordinates

Mouse coordinates are normalized `0-1` relative to the shared surface, not
pixels. The viewer never needs to know the host's resolution, DPI, or monitor
layout — call `updateScreenSize()` on the host and the injector maps them.

## Platform support

| Platform          | Backend            | Requirements                                          |
| ----------------- | ------------------ | ----------------------------------------------------- |
| macOS             | `nut-js`           | Accessibility permission (see below)                  |
| Windows           | `nut-js`           | None. Admin only to drive elevated windows.           |
| Linux / X11       | `nut-js`           | None                                                  |
| Linux / Wayland   | `wayland-ydotool`  | `ydotool` + a running `ydotoold` with `/dev/uinput`    |
| Linux / Wayland   | `wayland-portal`    | Diagnostic only — reports why control is unavailable   |

Backend selection is automatic. On Wayland the package probes `ydotool` first
(and will try to auto-start `ydotoold` via systemd), then falls back to a
backend whose only job is to explain, in `reason`, why control cannot work —
rather than failing silently.

```ts
import { detectDisplayServer, getInputBackendSelection } from '@profullstack/remote-input';

detectDisplayServer(); // 'macos' | 'windows' | 'x11' | 'wayland' | 'unknown'
getInputBackendSelection(); // { kind, platform, displayServer }
```

### macOS permission

macOS gates synthetic input behind Accessibility (TCC) and will not prompt on
your behalf from a background process. Check
`requiresAccessibilityPermission()` and send the user to
**System Settings → Privacy & Security → Accessibility**. In Electron,
`systemPreferences.isTrustedAccessibilityClient(true)` triggers the prompt.

### Linux / Wayland

```sh
sudo apt install ydotool          # or your distro's package
sudo systemctl enable --now ydotoold
```

`ydotoold` needs access to `/dev/uinput`. If the daemon starts and immediately
dies, that is almost always the cause; the backend surfaces this in
`getDiagnostics().reason`.

## Safety

Remote input is untrusted even after the host has approved the peer, so every
event passes three guards before it reaches the OS:

- **Validation** — coordinates must be finite and within `0-1`; scroll deltas
  must be finite; keys must be non-empty and of plausible length.
- **Rate limiting** — a sliding one-second window (default 1000 events/sec).
  Each injection is a synchronous OS call, so an unbounded stream is a cheap way
  to wedge the host.
- **Blocked combinations** — refused even while control is granted, because they
  either hand over a privileged surface or end the session in a way the remote
  peer cannot undo:

  | Combination            | Why                              |
  | ---------------------- | -------------------------------- |
  | `Ctrl+Alt+Delete`      | Secure attention / task manager  |
  | `Meta+L`               | Locks the screen                 |
  | `Meta+Alt+Escape`      | Force-quit picker                |
  | `Ctrl+Shift+Meta+Q`    | Logs the host out                |

Rejections are counted in `getDiagnostics().stats` and reported through
`onRejected`, so a host can surface them rather than lose them.

Injection is **off by default** and `enable()` returns `false` when the backend
cannot drive the machine — a host should never believe it granted control that
silently does nothing.

## API

| Export                            | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `RemoteInputInjector`             | The gated, validated, rate-limited injection path  |
| `getInputBackendSelection`        | Which backend applies to this host                 |
| `createInputBackend`              | Construct a backend directly                       |
| `selectInputBackend`              | Pure platform → backend-kind mapping               |
| `detectPlatform` / `detectDisplayServer` | Environment probes                          |
| `requiresAccessibilityPermission` | True on macOS                                      |
| `validateInputEvent`              | Single-event validation                            |
| `isDangerousCombination`          | Blocked-combination check                          |
| `InputRateLimiter`                | Sliding-window limiter                             |
| `BLOCKED_COMBINATIONS`            | The blocklist, for display in a UI                 |

Backends (`NutJsInputBackend`, `WaylandYdotoolInputBackend`,
`WaylandPortalInputBackend`, `UnsupportedWaylandInputBackend`) are exported for
hosts that want to select or wrap one themselves. Any object satisfying the
`InputBackend` interface can be supplied via `createBackend`, which is also the
seam for testing without touching a real desktop.

## License

MIT
