#!/bin/sh
# Install PairUX on macOS or Linux: the desktop app plus the `pairux` command
# (launch, update, uninstall, and the agent commands join/listen/say/who).
#
#   curl -fsSL https://pairux.com/install.sh | sh
#
# The installer itself is bash (apps/installer/scripts/install.sh in
# github.com/profullstack/pairux.com). This POSIX wrapper exists so the line
# above works with `| sh` on systems where sh is dash. It fetches that script
# and runs it with bash, passing any arguments through:
#
#   curl -fsSL https://pairux.com/install.sh | sh -s -- <args>
#
# Everything installs under ~/.pairux and ~/.local. On a Wayland session the
# installer may ask for sudo to install remote-control dependencies (ydotool,
# /dev/uinput access); nothing else needs root.
set -eu

SCRIPT_URL="${PAIRUX_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/profullstack/pairux.com/master/apps/installer/scripts/install.sh}"

die() { printf 'pairux install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) die "unsupported OS $(uname -s). For Windows see https://pairux.com/download" ;;
esac

have bash || die "bash is required (install it with your package manager, then re-run)"

tmp=$(mktemp "${TMPDIR:-/tmp}/pairux-install.XXXXXX")
trap 'rm -f "$tmp"' EXIT INT TERM

if have curl; then
  curl -fsSL "$SCRIPT_URL" -o "$tmp" || die "could not download $SCRIPT_URL"
elif have wget; then
  wget -qO "$tmp" "$SCRIPT_URL" || die "could not download $SCRIPT_URL"
else
  die "needs curl or wget"
fi

head -n 1 "$tmp" | grep -q '^#!' || die "downloaded installer does not look like a script: $SCRIPT_URL"

bash "$tmp" "$@"
