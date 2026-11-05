#!/bin/sh
# Mints the Play upload key once. Runs inside eclipse-temurin:17-jdk with the output
# dir mounted at /keys. Store both files in the vault (pairux-android--signing as
# ANDROID_KEYSTORE_B64 + ANDROID_STORE_PASSWORD), never in the repo.
#
# This is the UPLOAD key, not the app signing key: Play keeps the signing key once
# you enrol in Play App Signing, so losing this one is recoverable (Google can reset
# it) while losing a Play-managed signing key is not. Do not run this twice anyway.
set -eu
[ -f /keys/upload.jks ] && { echo "refusing: /keys/upload.jks exists"; exit 1; }
umask 077
PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
keytool -genkeypair -keystore /keys/upload.jks -storetype PKCS12 -alias pairux \
  -keyalg RSA -keysize 4096 -validity 36500 -storepass "$PW" \
  -dname "CN=PairUX (pairux.com), O=Profullstack, C=US" >/dev/null 2>&1
printf 'ANDROID_STORE_PASSWORD=%s\nANDROID_KEY_ALIAS=pairux\n' "$PW" > /keys/upload.env
[ -n "${OWNER:-}" ] && chown "$OWNER" /keys/upload.jks /keys/upload.env
keytool -list -keystore /keys/upload.jks -storepass "$PW" | tail -2
