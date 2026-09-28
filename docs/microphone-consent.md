# Viewer microphone consent

Web and desktop P2P/SFU viewers treat a valid remote unmute as a request, never
as permission to enable microphone audio. The viewer uses the existing local
microphone button to accept. Repeated requests share one passive status notice.
SFU requests must be addressed to this viewer and come from a current screen
publisher. Missing or non-boolean mute values are ignored.

Mute intent survives manual and LiveKit reconnect within the same hook instance.
Unmount/disconnect disposes pending acquisition work; late captures are stopped.
An asynchronous SFU failure leaves the UI muted rather than claiming success.
Muting an existing track silences it immediately, then queues the SDK operation.
A track acquired inside an unresolved SDK operation cannot be silenced until
the SDK exposes it. This is not a guarantee of zero transient audio packets.

## Boundaries

- Initial join still follows the existing mic-on behavior and browser permission.
  A reload or remount is a new join, not durable saved consent.
- P2P track disabling silences outgoing audio; it does not turn off the physical
  microphone or necessarily dismiss the operating system recording indicator.
- A screen publisher is a routing check, not proof of repository/session owner
  authorization. This does not fix the pre-existing SFU token/metadata authority,
  kick or control-grant authorization paths. Audit those before claiming rooms
  are secure against malicious members.
- Tests cover mocked LiveKit permission/lifecycle races and real local Chromium
  P2P audio/data-channel behavior. They do not certify LiveKit production, TURN,
  Windows/macOS permissions, real microphone devices, or a signed Electron build.

## Regression checks

Run shared-types build/test, then the complete web and desktop test, typecheck
and lint scripts. Hook tests cover malformed/foreign messages, local consent,
permission denial, late capture, manual/SDK reconnect and stale room callbacks.
Viewer page tests cover a passive request and the explicit local button.
