#!/bin/sh
# Mints the release keystore once. Runs inside eclipse-temurin:17-jdk with the
# output dir mounted at /keys. Store both files in the vault (pairux-firetv--signing as
# PX_TV_KEYSTORE_B64 + PX_TV_STORE_PASSWORD), never in the repo. Losing this key
# means Fire TV users cannot update in place, so do not run it twice.
set -eu
[ -f /keys/release.jks ] && { echo "refusing: /keys/release.jks exists"; exit 1; }
umask 077
PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
keytool -genkeypair -keystore /keys/release.jks -storetype PKCS12 -alias pairux \
  -keyalg RSA -keysize 4096 -validity 36500 -storepass "$PW" \
  -dname "CN=PairUX (pairux.com), O=Profullstack, C=US" >/dev/null 2>&1
printf 'PX_TV_STORE_PASSWORD=%s\nPX_TV_KEY_ALIAS=pairux\n' "$PW" > /keys/release.env
[ -n "${OWNER:-}" ] && chown "$OWNER" /keys/release.jks /keys/release.env
keytool -list -keystore /keys/release.jks -storepass "$PW" | tail -2
