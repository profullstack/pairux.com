#!/bin/sh
# Renders the launcher icons, TV banner and Amazon Appstore art.
# icon.svg and logo-light.svg are PairUX's own artwork, copied from apps/web/public.
# Runs inside alpine: docker run --rm -v "$PWD/firetv:/w" -w /w alpine:3.20 sh store/render.sh
set -eu
apk add --no-cache rsvg-convert imagemagick font-dejavu >/dev/null
R=app/src/main/res
O=store/out
S=store/src
mkdir -p "$O" "$R/mipmap-xhdpi" "$R/mipmap-xxhdpi" "$R/drawable-xhdpi"

# Launcher + Appstore icons: the mark on its own, transparency kept.
rsvg-convert -w 96 -h 96 "$S/icon.svg" -o "$R/mipmap-xhdpi/ic_launcher.png"
rsvg-convert -w 144 -h 144 "$S/icon.svg" -o "$R/mipmap-xxhdpi/ic_launcher.png"
rsvg-convert -w 512 -h 512 "$S/icon.svg" -o "$O/icon-512.png"
rsvg-convert -w 114 -h 114 "$S/icon.svg" -o "$O/icon-114.png"

# Fire TV banner and background: the real logo lockup on the PairUX night blue.
# Fire TV art may not carry transparency, so these are flattened.
rsvg-convert -w 820 -h 290 "$S/logo-light.svg" -o /tmp/lockup.png
magick -size 1280x720 xc:'#0f172a' /tmp/lockup.png -geometry +120+200 -composite \
  -font DejaVu-Sans -pointsize 44 -fill '#3b82f6' -annotate +126+560 'watch a shared screen on your TV' \
  -alpha remove -alpha off "$O/firetv-icon-1280x720.png"
rsvg-convert -w 320 -h 180 "$S/banner.svg" -o "$R/drawable-xhdpi/banner.png"
rsvg-convert -w 1920 -h 1080 "$S/background.svg" -o /tmp/bg.png
magick /tmp/bg.png -background '#0f172a' -alpha remove -alpha off "$O/firetv-background-1920x1080.png"

[ -n "${OWNER:-}" ] && chown -R "$OWNER" "$R" "$O"
ls -l "$O"
