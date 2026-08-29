#!/usr/bin/env bash
#
# Records what the machine was doing in the seconds before a hard freeze.
#
# A freeze that forces a power-off takes the evidence with it: journald buffers
# in memory, and the desktop is too wedged to read anything off the screen. This
# writes one line per interval and fsyncs it, so the last line on disk after the
# reboot is the last moment the machine was alive.
#
#   ./scripts/freeze-watchdog.sh                # log to ~/pairux-freeze.log
#   ./scripts/freeze-watchdog.sh /tmp/other.log 1
#
# After a freeze, reboot and read the tail:
#
#   tail -30 ~/pairux-freeze.log
#
# What the last lines tell you:
#   * mem_avail_mb falling toward zero, swap_used climbing  -> memory exhaustion.
#     The kernel thrashes reclaim long before the OOM killer fires, which is what
#     a whole-desktop freeze on Ubuntu usually is. `rss_top` names the culprit.
#   * everything steady, log just stops                     -> not memory. Suspect
#     a GPU/driver hang; check `journalctl -b -1 -k | grep -iE 'gpu|drm|i915|amdgpu'`.
#   * cpu_load pinned at/above core count with memory fine  -> saturation, not a leak.

set -uo pipefail

LOG="${1:-$HOME/pairux-freeze.log}"
INTERVAL="${2:-2}"
CORES="$(nproc)"

printf 'watchdog started %s | interval=%ss | cores=%s | log=%s\n' \
  "$(date -Is)" "$INTERVAL" "$CORES" "$LOG" | tee -a "$LOG"

while true; do
  ts="$(date -Is)"

  # MemAvailable is the honest number: "free" ignores reclaimable page cache.
  read -r mem_avail_mb mem_total_mb swap_used_mb < <(
    awk '/^MemAvailable:/{a=$2} /^MemTotal:/{t=$2} /^SwapTotal:/{st=$2} /^SwapFree:/{sf=$2}
         END{printf "%d %d %d", a/1024, t/1024, (st-sf)/1024}' /proc/meminfo
  )

  load="$(awk '{print $1}' /proc/loadavg)"

  # The three biggest resident processes, so a runaway names itself.
  rss_top="$(ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -3 |
    awk '{printf "%s=%dMB ", $2, $1/1024}')"

  # Everything the Electron app is holding, summed across its helper processes.
  pairux_mb="$(ps -eo rss=,args= 2>/dev/null |
    grep -i pairux | grep -v grep |
    awk '{s+=$1} END{printf "%d", s/1024}')"
  pairux_procs="$(pgrep -ic -f pairux 2>/dev/null || echo 0)"

  printf '%s mem_avail_mb=%s/%s swap_used_mb=%s cpu_load=%s/%s pairux_rss_mb=%s pairux_procs=%s rss_top=%s\n' \
    "$ts" "$mem_avail_mb" "$mem_total_mb" "$swap_used_mb" "$load" "$CORES" \
    "${pairux_mb:-0}" "$pairux_procs" "$rss_top" >> "$LOG"

  # Without this the last few seconds — the ones that matter — die in the page
  # cache when power is cut.
  sync -d "$LOG" 2>/dev/null || sync

  sleep "$INTERVAL"
done
