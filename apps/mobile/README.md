# PairUX Mobile

The mobile client is an Expo development build for Android and iOS. It uses native WebRTC,
so it does not run in Expo Go.

Expo SDK 52 is intentionally pinned to the legacy React Native architecture for this app. The
current `react-native-webrtc` release is not yet verified against the New Architecture, and WebRTC
is the core transport rather than an optional dependency.

## Prerequisites

- Node.js 24
- pnpm 9.15.0 (the version pinned by the workspace)
- Android Studio and an Android SDK for local Android builds
- macOS and Xcode, or an Expo EAS account, for iOS builds

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

## Verify the app

Run the mobile lint, typecheck, test suite, and production bundle check together with its workspace
dependencies:

```bash
pnpm check:mobile
```

The web and desktop apps use React 19, while Expo SDK 52 requires React 18 for the mobile client.
The workspace package extensions attach missing React peer declarations to mobile dependencies so
pnpm resolves them against the mobile runtime. The bundle verification step reads the production
source map and fails if a second React runtime is introduced.

Generate the native Android and iOS projects without installing platform dependencies:

```bash
pnpm build:mobile -- --no-install
```

## Local development

Local development uses `https://pairux.com` by default. To target a local server, use a LAN address
that the emulator or device can reach. `localhost` on a physical device points back to that device.

```bash
PAIRUX_API_URL=http://192.168.1.10:3000 pnpm dev:mobile
```

Start a native development build with one of these root commands:

```bash
pnpm mobile:android
pnpm mobile:ios
```

## Call continuity

The mobile host and viewer intentionally close their SSE, WebRTC peer, media, and stats resources
when the app leaves the foreground. If a call was active or still connecting, returning to the
foreground starts exactly one fresh connection through the normal authentication and signaling
path. A server heartbeat watchdog also replaces a connection that has stopped receiving SSE
heartbeats for 75 seconds.

Reconnects preserve the user's microphone mute choice. Async media and signaling callbacks are
scoped to a connection generation, so a late callback from a backgrounded or unmounted screen
cannot restore stale peers, viewers, chat history, or microphone state. This is foreground call
recovery, not background audio support.

An active screen share ends when the app reaches the background and must be started again after
returning. The capture hook owns that teardown so its UI cannot report a stopped native track as
still sharing. A brief iOS `inactive` transition alone does not tear down the call or screen share.

## EAS builds

Link the app to the intended Expo project and provide its UUID through `EAS_PROJECT_ID`. No
placeholder project ID is committed because it prevents EAS from linking the correct project.
Create both `EAS_PROJECT_ID` and `PAIRUX_API_URL` as plain-text EAS environment variables for each
build environment. The profiles in `eas.json` select their matching `development`, `preview`, and
`production` environments, and configuration fails early if either value is missing during an EAS
build. This prevents a preview build from silently using the production API.

```bash
eas env:create --name EAS_PROJECT_ID --value <expo-project-uuid> --environment preview --visibility plaintext
eas env:create --name PAIRUX_API_URL --value https://pairux.com --environment preview --visibility plaintext
eas build --platform android --profile preview
eas build --platform ios --profile preview
```

Signed device builds and store submission additionally require the matching Google Play and
Apple Developer credentials. Keep those credentials in EAS or the platform account, never in
the repository.

## Screen sharing support

Android prebuilds enable the foreground MediaProjection service bundled with
`react-native-webrtc`. This is required for screen capture on current Android releases. On Android
13 and newer, a production app should declare and request `POST_NOTIFICATIONS` before screen
capture if the foreground-service notification must remain visible in the notification drawer.
MediaProjection can still start without that permission, but Android shows the foreground-service
notice only in Task Manager when notification permission is denied. The generated app removes the
camera and system-overlay permissions inherited from the WebRTC dependency because PairUX currently
uses screen capture and voice, not camera capture or overlay windows.

The host UI reports sharing as active only after the captured stream has been published to the
current viewers. Capture permission, publication, active sharing, and shutdown are serialized so
repeated taps cannot start duplicate MediaProjection sessions. PairUX also stops and unpublishes the
capture when Android ends it from the system controls, when the host leaves the session tab, or when
the session screen unmounts.

The generated iOS app includes native WebRTC and supports joining sessions and voice chat. Full
device screen broadcasting on iOS additionally requires a ReplayKit Broadcast Upload Extension,
an App Group, and matching Apple signing entitlements. Those are a separate native milestone; do
not treat a successful JavaScript bundle as proof that iOS broadcasting is configured. The PairUX
app config currently enables the `voip` background mode; remove it or add the matching
CallKit/PushKit flow before an App Store submission.
