# Mobile microphone consent and recovery

A host mute command can disable the viewer microphone. An unmute command is
only a request: it shows feedback while the viewer remains muted. Only the
viewer's local Unmute button changes that intent. Missing or non-boolean mute
payloads are ignored. Old data-channel callbacks are generation-guarded and
muted intent survives reconnect, including delayed microphone acquisition.

This does not change the existing initially-enabled microphone preference at
join, implement a request/acknowledgement protocol, or change host UI optimistic
mute labels. The host cannot assume a viewer accepted an unmute request.

Host and viewer show listen-only feedback when microphone acquisition fails.
Only recognized permission errors offer a user-initiated native Settings action;
unknown device errors are not called permission denials. Opening Settings can
background the app. The existing foreground-resume path reconnects and
reacquires the mic: after permission is granted, audio follows the existing
initially-on preference or the preserved muted intent. A Settings return is
not a new local-unmute consent gate. There is no permission prompt or acquisition
caused by an incoming unmute message. Ended tracks are never treated as usable
when toggling the microphone.

The pinned pnpm patch for react-native-webrtc 124.0.7 forwards permission-chain
rejections to the caller. Without it, an iOS permission-bridge rejection or a
synchronous capture-start failure leaves acquisition pending with an unhandled
rejection. The patch covers Metro source, CommonJS and ESM builds. Host/viewer
then follow the existing listen-only failure path. Normal user permission
decisions and successful acquisition are unchanged. A permission dialog the
user has not answered can still remain pending; this patch is not a timeout or
native-dialog cancellation mechanism.

`webrtc-permissions.test.ts` executes the installed dependency's JS permission
chain in all three formats, with only native bridge and stream boundaries
replaced. It checks grants, denials, bridge rejection and capture-start throws.
Re-run these tests whenever upgrading WebRTC or changing/removing its patch.

Hook tests cover data-channel payloads, reconnect and permission failures.
Component and real session-route tests check feedback and local button wiring
with native APIs mocked. These do not verify native permission dialogs, device
audio routing, or real WebRTC audio. Before release, check denied/granted mic
permission, host mute/request-unmute, reconnect and Settings on Android and iOS.
