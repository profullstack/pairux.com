#!/bin/sh
# Renders the launcher icons and the Play listing art from store/src.
#   docker run --rm -v "\$PWD/appstores/android:/w" -w /w alpine:3.20 sh store/render.sh
# Play wants a 512x512 icon and a 1024x500 feature graphic; the feature graphic is
# flattened because Play rejects transparency there.
set -eu
apk add --no-cache imagemagick rsvg-convert >/dev/null
R=app/src/main/res
O=store/out
S=store/src
mkdir -p "$O"

if [ -f "$S/mark.png" ]; then MARK="$S/mark.png"; else
  rsvg-convert -w 1024 -h 1024 "$S/mark.svg" -o /tmp/mark.png; MARK=/tmp/mark.png; fi

for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dpi=${d%%:*}; px=${d##*:}
  mkdir -p "$R/mipmap-$dpi"
  magick "$MARK" -resize ${px}x${px} "$R/mipmap-$dpi/ic_launcher.png"
done

magick "$MARK" -resize 512x512 "$O/icon-512.png"

if [ -f "$S/wordmark.png" ]; then LOCK="$S/wordmark.png"; elif [ -f "$S/wordmark.svg" ]; then
  rsvg-convert -w 900 "$S/wordmark.svg" -o /tmp/lock.png; LOCK=/tmp/lock.png; else LOCK="$MARK"; fi
magick -size 1024x500 xc:'#0f172a' \( "$LOCK" -resize 760x340 \) -gravity center -composite \
  -alpha remove -alpha off "$O/feature-1024x500.png"

[ -n "${OWNER:-}" ] && chown -R "$OWNER" "$R" "$O"
ls -l "$O"
