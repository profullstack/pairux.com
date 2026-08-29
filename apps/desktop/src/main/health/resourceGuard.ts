/**
 * Stops the share before the host machine dies.
 *
 * A screen-share host is one of the few desktop apps that can genuinely take a
 * whole machine down: it encodes video, composites a canvas, writes a recording
 * and feeds ffmpeg, all at once, for as long as the session lasts. On Linux the
 * failure mode is not a tidy crash — with little or no swap the kernel thrashes
 * page reclaim long before the OOM killer picks a victim, and the desktop stops
 * responding hard enough to need a power cycle. The user loses the machine, and
 * because nothing ever ran `recording:stop`, they lose the recording too: the
 * WebM is left without the metadata that finalises it.
 *
 * So watch how much memory the OS still has, and when it gets genuinely scarce,
 * shut our own load down first. Stopping a share is a bad outcome; being the
 * reason someone has to hold their power button is a worse one — and a clean
 * stop finalises the recording, which a freeze does not.
 */

import * as fs from 'fs';
import * as os from 'os';

export type MemoryPressure = 'ok' | 'warning' | 'critical';

export interface MemorySnapshot {
  /** MB the OS can hand out without swapping. */
  availableMb: number;
  /** MB of RAM installed. */
  totalMb: number;
}

export interface PressureThresholds {
  warningMb: number;
  criticalMb: number;
}

/**
 * Absolute headroom, not a percentage: what makes a desktop seize is the number
 * of megabytes left, and a percentage would set an absurd bar on a 64GB
 * workstation and a uselessly low one on an 8GB laptop.
 */
export const DEFAULT_THRESHOLDS: PressureThresholds = {
  warningMb: 1_500,
  criticalMb: 600,
};

export const POLL_INTERVAL_MS = 5_000;

/**
 * Read how much memory is actually available.
 *
 * On Linux this must be MemAvailable, not MemFree. MemFree excludes reclaimable
 * page cache, so a perfectly healthy machine reports almost none of it and any
 * threshold against it would fire constantly. MemAvailable is the kernel's own
 * estimate of what a new allocation could get, which is the question being
 * asked here.
 */
export function readSystemMemory(
  readFile: (path: string) => string = defaultReadFile
): MemorySnapshot {
  if (process.platform === 'linux') {
    try {
      const meminfo = readFile('/proc/meminfo');
      const available = matchKb(meminfo, 'MemAvailable');
      const total = matchKb(meminfo, 'MemTotal');
      if (available !== null && total !== null) {
        return { availableMb: Math.round(available / 1024), totalMb: Math.round(total / 1024) };
      }
    } catch {
      // Fall through to the portable numbers.
    }
  }

  return {
    availableMb: Math.round(os.freemem() / 1024 / 1024),
    totalMb: Math.round(os.totalmem() / 1024 / 1024),
  };
}

function defaultReadFile(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function matchKb(meminfo: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(meminfo);
  return match ? Number(match[1]) : null;
}

export function classifyMemory(
  snapshot: MemorySnapshot,
  thresholds: PressureThresholds = DEFAULT_THRESHOLDS
): MemoryPressure {
  if (snapshot.availableMb <= thresholds.criticalMb) return 'critical';
  if (snapshot.availableMb <= thresholds.warningMb) return 'warning';
  return 'ok';
}

export interface ResourceGuardDeps {
  /** True while there is something worth shutting down. */
  isSharing: () => boolean;
  /** Shed load: stop capture, recording and any egress. */
  onCritical: (snapshot: MemorySnapshot) => void;
  /** Tell the user once, while there is still room to act. */
  onWarning?: (snapshot: MemorySnapshot) => void;
  readMemory?: () => MemorySnapshot;
  thresholds?: PressureThresholds;
  intervalMs?: number;
}

/**
 * Begin watching. Returns the stop function.
 *
 * Each level fires once per episode and re-arms only after memory recovers to
 * 'ok'. Without that, a machine sitting just under the line would fire on every
 * poll — and the critical handler tears a session down, so repeating it would
 * turn one bad moment into a loop.
 */
export function startResourceGuard(deps: ResourceGuardDeps): () => void {
  const {
    isSharing,
    onCritical,
    onWarning,
    readMemory = () => readSystemMemory(),
    thresholds = DEFAULT_THRESHOLDS,
    intervalMs = POLL_INTERVAL_MS,
  } = deps;

  let reported: MemoryPressure = 'ok';

  const tick = (): void => {
    // Only meaningful while we are the load. Sitting idle at the login screen,
    // the machine's memory is somebody else's business.
    if (!isSharing()) {
      reported = 'ok';
      return;
    }

    const snapshot = readMemory();
    const pressure = classifyMemory(snapshot, thresholds);

    if (pressure === 'ok') {
      reported = 'ok';
      return;
    }
    if (pressure === reported) return;
    // Dropping back to 'warning' after 'critical' is a recovery, not a new
    // thing to announce.
    if (pressure === 'warning' && reported === 'critical') return;

    reported = pressure;

    if (pressure === 'critical') {
      console.error(
        `[ResourceGuard] Only ${String(snapshot.availableMb)}MB of ${String(snapshot.totalMb)}MB available — stopping the share before the machine stalls`
      );
      onCritical(snapshot);
    } else {
      console.warn(
        `[ResourceGuard] Memory is low: ${String(snapshot.availableMb)}MB of ${String(snapshot.totalMb)}MB available`
      );
      onWarning?.(snapshot);
    }
  };

  const timer = setInterval(tick, intervalMs);
  // Never hold the process open just to take a measurement.
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
