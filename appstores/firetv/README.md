# pairux.com for Fire TV

A small native Android app (`com.pairux.tv`) that puts https://pairux.com on a Fire TV
and makes it work with a remote. No dependencies beyond the Android SDK.

- **WebView** on pairux.com. Results open in the app; `mailto:`/`intent:` links go to the system.
- **Remote navigation** (`app/src/main/assets/tv.js`): Chromium's WebView scrolls on arrow
  keys instead of moving between links, so every D-pad press runs `pitNav(dir)` in the page:
  spatial focus to the nearest link/button, scrolling across long gaps, and a large focus
  ring. The ring is set through `element.style` because pairux.com's CSP (`style-src 'self'`)
  blocks an injected `<style>`.
- **Typing**: OK on a text field (or Menu/Search anywhere) opens a native text box, the one
  thing that reliably raises the Fire TV keyboard and its microphone. The text goes back into
  the page and a search box submits.
- **Back** walks WebView history, then exits. Full-screen video and an offline screen are native.
- Leanback launcher + banner, touchscreen not required, so the Appstore lists it for Fire TV.

## Build

Needs only Docker. The SDK caches in `~/scratch/android-sdk`.

```sh
# release key (once, ever): vault profullstack/pit-world-firetv--signing
logicsrc teams pull profullstack pit-world-firetv signing --env keys/release.env
sed -n 's/^PX_TV_KEYSTORE_B64=//p' keys/release.env | tr -d '"' | base64 -d > keys/release.jks

docker run --rm -e OWNER=$(id -u):$(id -g) -e GRADLE_USER_HOME=/gh \
  -v ~/scratch/gradle-home:/gh -v ~/scratch/android-sdk:/sdk -v "$PWD/keys:/keys:ro" \
  -v "$PWD/appstores/firetv:/w" -w /w gradle:8.7-jdk17 sh build.sh
# -> firetv/dist/pairux.com-firetv.apk (lint + signed release)
```

Without `/keys` the APK is built unsigned. Bump `versionCode`/`versionName` in
`app/build.gradle` for every Appstore upload. `new-key.sh` minted the key; never run it
again or installed copies cannot update.

## Test on an Android TV emulator

```sh
docker run --rm --device /dev/kvm -e OWNER=$(id -u):$(id -g) -v ~/scratch/android-sdk:/sdk \
  -v "$PWD/appstores/firetv:/w" -w /w gradle:8.7-jdk17 bash emulator-test.sh
```

Boots API 30 Android TV (the base of Fire OS 8), installs the APK, drives it with key
events (OK -> keyboard -> search, arrows through results, Back, Menu search for a Moshpit
name) and writes 1920x1080 screenshots to `store/shots/`.

## Appstore

Listing copy and the art map are in `store/listing.md`; `store/render.sh` regenerates the
icons/banner from `store/src/*.svg`.
