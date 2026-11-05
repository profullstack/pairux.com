#!/bin/sh
# Builds the Play bundle and a sideloadable APK. Runs inside gradle:8.7-jdk17:
#   docker run --rm -e OWNER=\$(id -u):\$(id -g) \\
#     -v "\$PWD/android-sdk:/sdk" -v "\$PWD/keys:/keys" \\
#     -v "\$PWD/appstores/android:/w" -w /w gradle:8.7-jdk17 sh build.sh
#   /sdk    Android SDK cache (installed on first run)
#   /keys   optional: upload.jks + upload.env to sign with
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
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platforms;android-35" "build-tools;35.0.0" >/dev/null
export ANDROID_HOME="$SDK"

if [ -f /keys/upload.jks ]; then
  set -a; . /keys/upload.env; set +a
  export ANDROID_KEYSTORE=/keys/upload.jks
fi

# bundleRelease is what Play takes; assembleRelease is for sideloading and testing.
gradle --no-daemon -q lint bundleRelease assembleRelease
mkdir -p dist
cp app/build/outputs/bundle/release/app-release.aab "dist/pairux.aab"
APK=$(ls app/build/outputs/apk/release/*.apk | head -1)
cp "$APK" "dist/pairux.apk"
"$SDK/build-tools/35.0.0/apksigner" verify --print-certs "dist/pairux.apk" | head -3 || true
"$SDK/build-tools/35.0.0/aapt2" dump badging "dist/pairux.apk" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label)" || true
[ -n "${OWNER:-}" ] && chown -R "$OWNER" dist app/build .gradle 2>/dev/null
ls -l dist
