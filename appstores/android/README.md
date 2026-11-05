# Google Play (pairux.com)

A WebView shell for https://pairux.com. Package `com.pairux.app`, minSdk 24, targetSdk 35.

## Build

```sh
docker run --rm -e OWNER=$(id -u):$(id -g) \
  -v "$PWD/android-sdk:/sdk" -v "$PWD/keys:/keys" \
  -v "$PWD/appstores/android:/w" -w /w gradle:8.7-jdk17 sh build.sh
```

`dist/pairux.aab` is what Play takes; `dist/pairux.apk` is for sideloading and testing.
Art: `docker run --rm -v "$PWD/appstores/android:/w" -w /w alpine:3.20 sh store/render.sh`.

## Signing

The upload key is in vault `profullstack/pairux-android--signing`
(`ANDROID_KEYSTORE_B64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`).

This is the **upload** key, not the app signing key. Once enrolled in Play App
Signing, Google holds the signing key and re-signs every upload, so a lost upload
key can be reset by support; a lost Play-managed signing key cannot. `new-key.sh`
refuses to mint a second one.

## What it adds over the website

Play rejects a bare web wrapper. This one is a launcher entry plus: `pairux.com` links
opening in the app (`autoVerify` App Links), the system Back button walking the
page's own history, `<input type=file>` working (a WebView does nothing on file
inputs without `onShowFileChooser`), `getUserMedia` bridged to Android's own
permission prompt, full-screen video, and an offline screen instead of Chrome's.

## Before the first release

- Play Console account: **anthony@profullstack.com**.
- Play takes an **.aab**, never an APK, and raises its `targetSdk` floor every
  August — check it rather than trusting the 35 here.
- `applicationId` can never change after publishing.
- The Data safety form and content rating questionnaire are required, and ask the
  same facts as Amazon's listing in a different shape.
- A new personal Play account needs 12 testers on a closed test for 14 days before
  production opens. An organisation account needs D-U-N-S verification instead.

## Listing

Copy and art live in `store/` — see `store/listing.md`.

## Known limit: old WebViews

On an API 30 emulator (WebView ~Chromium 83) the app launches and the page renders completely unstyled. pairux.com is built with Tailwind v4, whose stylesheet wraps everything in `@layer`; an engine without cascade layers (below Chromium 99) drops every layered block, and `color-mix()` needs 111. The page is readable but unstyled, not broken.

Google Play devices update WebView through the Play Store, so a current phone
renders this correctly whatever its Android version — the floor only bites on
devices that cannot update WebView, which is why it matters far more for
`../firetv` than it does here. Check a real device before the first release.
