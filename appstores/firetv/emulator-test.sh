#!/bin/bash
# Boots an Android TV emulator (API 30, the base of Fire OS 8), installs the APK,
# drives it with remote-control keys and saves 1920x1080 screenshots to store/shots.
# Runs inside gradle:8.7-jdk17 with --device /dev/kvm and the SDK cache at /sdk:
#   docker run --rm --device /dev/kvm -v ~/scratch/android-sdk:/sdk -v "$PWD/firetv:/w" -w /w \
#     gradle:8.7-jdk17 bash emulator-test.sh
set -euo pipefail
SDK=/sdk
export ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK ANDROID_AVD_HOME=/root/.android/avd
IMG="system-images;android-30;android-tv;x86"

apt-get update -qq >/dev/null
apt-get install -y -qq libpulse0 libnss3 libxcomposite1 libxcursor1 libxi6 libxtst6 \
  libasound2 libgl1 libxkbfile1 libxdamage1 libxrandr2 libdrm2 libgbm1 >/dev/null 2>&1

SM="$SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK"
(yes || true) | $SM --licenses >/dev/null || true   # yes dies of SIGPIPE: not a failure
$SM "emulator" "platform-tools" "$IMG" >/dev/null

echo no | "$SDK/cmdline-tools/latest/bin/avdmanager" create avd -n tv -k "$IMG" -d tv_1080p --force >/dev/null
ADB="$SDK/platform-tools/adb"
"$SDK/emulator/emulator" -avd tv -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect \
  -no-snapshot -memory 2048 >/tmp/emu.log 2>&1 &

"$ADB" wait-for-device
for i in $(seq 1 120); do
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
  sleep 2
done
echo "booted"
"$ADB" shell wm size

# The package manager comes up a little after boot_completed; retry until it takes.
for i in $(seq 1 20); do "$ADB" install -r dist/pairux-firetv.apk && break; sleep 5; done
mkdir -p store/shots
shot() { "$ADB" exec-out screencap -p > "store/shots/$1.png"; echo "shot $1"; }
key() { "$ADB" shell input keyevent "$@"; sleep 1.2; }
focus() { "$ADB" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true; }

# 1. Leanback launch, the way the Fire TV home screen opens it.
"$ADB" shell monkey -p com.pairux.tv -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null
sleep 12
focus
shot 01-home

# 2. The home page autofocuses the search box: OK raises the Fire TV keyboard.
#    (Arrows moving the focus ring are checked on the results page below.)
key KEYCODE_DPAD_CENTER
sleep 2
focus
shot 03-keyboard
"$ADB" shell input text "demo"
key KEYCODE_ENTER
sleep 10
shot 04-results
key KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN KEYCODE_DPAD_DOWN
shot 05-results-nav
key KEYCODE_DPAD_RIGHT
shot 05b-results-right

# 3. Back returns to the home page, Back again leaves the app.
key KEYCODE_BACK
sleep 4
shot 06-back
key KEYCODE_BACK
sleep 2
focus

# 4. Menu key opens the standalone search box.
"$ADB" shell monkey -p com.pairux.tv -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null
sleep 8
key KEYCODE_MENU
sleep 2
shot 07-menu-search
"$ADB" shell input text "demo"
key KEYCODE_ENTER
sleep 10
shot 08-code-entered

"$ADB" logcat -d | grep -E "AndroidRuntime|FATAL|com.pairux.tv|chromium.*Uncaught" | tail -20 || true
[ -n "${OWNER:-}" ] && chown -R "$OWNER" store/shots
ls -l store/shots
