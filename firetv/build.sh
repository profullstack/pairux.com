#!/bin/sh
# Builds the Fire TV APK. Runs inside gradle:8.7-jdk17; see README.md for the docker line.
#   /sdk     Android SDK cache (installed on first run)
#   /keys    optional: release.jks + release.env (PX_TV_STORE_PASSWORD=...) to sign
set -eu
SDK=/sdk
TOOLS=commandlinetools-linux-11076708_latest.zip
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$SDK/cmdline-tools"
  curl -fsSL "https://dl.google.com/android/repository/$TOOLS" -o /tmp/tools.zip
  unzip -q /tmp/tools.zip -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platforms;android-34" "build-tools;34.0.0" >/dev/null
export ANDROID_HOME="$SDK"

if [ -f /keys/release.jks ]; then
  set -a; . /keys/release.env; set +a
  export PX_TV_KEYSTORE=/keys/release.jks
fi

gradle --no-daemon -q lint assembleRelease
OUT=app/build/outputs/apk/release
APK=$(ls "$OUT"/*.apk | head -1)
"$SDK/build-tools/34.0.0/apksigner" verify --print-certs "$APK" | head -3 || true
"$SDK/build-tools/34.0.0/aapt2" dump badging "$APK" | grep -E "^(package|sdkVersion|targetSdkVersion|leanback|application-label|uses-feature)" || true
mkdir -p dist
cp "$APK" dist/pairux-firetv.apk
[ -n "${OWNER:-}" ] && chown -R "$OWNER" dist app/build .gradle 2>/dev/null
ls -l dist
