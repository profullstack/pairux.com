#!/bin/sh
# Renders the launcher icons, TV banner and Amazon Appstore art from store/src/*.svg.
# Runs inside alpine (see firetv/README.md): docker run --rm -v "$PWD/firetv:/w" -w /w alpine:3.20 sh store/render.sh
set -eu
apk add --no-cache rsvg-convert font-dejavu >/dev/null
R=app/src/main/res
O=store/out
mkdir -p "$O" "$R/mipmap-xhdpi" "$R/mipmap-xxhdpi" "$R/drawable-xhdpi"

rsvg-convert -w 96 -h 96 store/src/icon.svg -o "$R/mipmap-xhdpi/ic_launcher.png"
rsvg-convert -w 144 -h 144 store/src/icon.svg -o "$R/mipmap-xxhdpi/ic_launcher.png"
rsvg-convert -w 320 -h 180 store/src/banner.svg -o "$R/drawable-xhdpi/banner.png"

rsvg-convert -w 512 -h 512 store/src/icon.svg -o "$O/icon-512.png"
rsvg-convert -w 114 -h 114 store/src/icon.svg -o "$O/icon-114.png"
rsvg-convert -w 1280 -h 720 store/src/banner.svg -o "$O/firetv-icon-1280x720.png"
rsvg-convert -w 1920 -h 1080 store/src/background.svg -o "$O/firetv-background-1920x1080.png"
# The container writes as root; hand the files back to whoever ran it.
[ -n "${OWNER:-}" ] && chown -R "$OWNER" "$R" "$O"
ls -l "$O"
