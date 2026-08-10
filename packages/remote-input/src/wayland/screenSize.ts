/**
 * Best-effort screen size on Wayland.
 *
 * ydotool positions the pointer in absolute coordinates, so a wrong screen size
 * puts every remote click in the wrong place — on a 4K display the 1920×1080
 * default lands roughly half way to the target. No single command works across
 * compositors, so each known one is probed in turn.
 *
 * Sizes are returned in *logical* pixels (mode divided by scale), which is the
 * space the compositor positions the pointer in. Only the first enabled output
 * is considered: a multi-monitor host gets an authoritative size later, from
 * `updateScreenSize()` once the capture stream reports its dimensions. This is
 * about being roughly right before that happens rather than badly wrong.
 */

export interface ScreenSize {
  width: number;
  height: number;
}

/** Runs a command and resolves its stdout, or rejects if it cannot be used. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

/** Long enough for a busy session, short enough not to stall startup. */
const PROBE_TIMEOUT_MS = 1000;

function toLogicalSize(width: number, height: number, scale: number): ScreenSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    width: Math.round(width / safeScale),
    height: Math.round(height / safeScale),
  };
}

/**
 * Parse `wlr-randr` (wlroots: Sway, Hyprland, River, …).
 *
 * Output is one block per output, with modes indented beneath. The mode in use
 * is tagged `current` — matching the first `WxH` in the whole output instead
 * would return whichever mode happens to be listed first, which is usually the
 * highest the monitor supports rather than the one it is running.
 */
export function parseWlrRandr(raw: string): ScreenSize | null {
  for (const block of splitOutputBlocks(raw)) {
    if (/^\s*Enabled:\s*no\b/im.test(block)) continue;

    const mode = /^\s*(\d+)\s*x\s*(\d+)\s*px[^\n]*\bcurrent\b/im.exec(block);
    if (!mode) continue;

    const scale = /^\s*Scale:\s*([\d.]+)/im.exec(block);
    return toLogicalSize(Number(mode[1]), Number(mode[2]), scale ? Number(scale[1]) : 1);
  }

  return null;
}

/** Split `wlr-randr` output into per-output blocks (unindented header lines). */
function splitOutputBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of raw.split('\n')) {
    const isHeader = line.length > 0 && !/^\s/.test(line);
    if (isHeader && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));

  return blocks;
}

interface KscreenMode {
  id?: unknown;
  size?: { width?: unknown; height?: unknown };
}

interface KscreenOutput {
  enabled?: unknown;
  currentModeId?: unknown;
  scale?: unknown;
  modes?: unknown;
}

/**
 * Parse `kscreen-doctor --json` (KDE Plasma).
 *
 * Parsed as JSON rather than regexed: the payload lists every supported mode,
 * so pattern-matching the first `size` would happily return a mode the monitor
 * is not running.
 */
export function parseKscreenDoctor(raw: string): ScreenSize | null {
  let payload: { outputs?: unknown };
  try {
    payload = JSON.parse(raw) as { outputs?: unknown };
  } catch {
    return null;
  }

  const outputs = Array.isArray(payload.outputs) ? (payload.outputs as KscreenOutput[]) : [];

  for (const output of outputs) {
    if (output.enabled === false) continue;

    const modes = Array.isArray(output.modes) ? (output.modes as KscreenMode[]) : [];
    const currentId = output.currentModeId;
    const mode = modes.find((m) => m.id === currentId) ?? modes[0];
    const width = Number(mode?.size?.width);
    const height = Number(mode?.size?.height);
    const size = toLogicalSize(width, height, Number(output.scale ?? 1));
    if (size) return size;
  }

  return null;
}

/**
 * Parse `gdbus call … org.gnome.Mutter.DisplayConfig.GetCurrentState`.
 *
 * `GetCurrentState` is used rather than the deprecated `GetResources`. Each
 * mode tuple carries an `is-current` flag, which is the only reliable way to
 * tell the active mode from the list of supported ones.
 */
export function parseMutterCurrentState(raw: string): ScreenSize | null {
  const currentMode = /\('[^']*',\s*(\d+),\s*(\d+),[^()]*?'is-current':\s*<true>/.exec(raw);
  if (!currentMode) return null;

  const width = Number(currentMode[1]);
  const height = Number(currentMode[2]);

  // Logical monitors carry the applied scale: (x, y, scale, transform, …).
  const scale = /\(\s*\d+,\s*\d+,\s*([\d.]+),\s*\d+,\s*(?:true|false)/.exec(raw);

  return toLogicalSize(width, height, scale ? Number(scale[1]) : 1);
}

interface Probe {
  command: string;
  args: string[];
  parse: (raw: string) => ScreenSize | null;
}

const PROBES: Probe[] = [
  // wlroots: Sway, Hyprland, River, …
  { command: 'wlr-randr', args: [], parse: parseWlrRandr },
  // KDE Plasma
  { command: 'kscreen-doctor', args: ['--json'], parse: parseKscreenDoctor },
  // GNOME / Mutter
  {
    command: 'gdbus',
    args: [
      'call',
      '--session',
      '--dest',
      'org.gnome.Mutter.DisplayConfig',
      '--object-path',
      '/org/gnome/Mutter/DisplayConfig',
      '--method',
      'org.gnome.Mutter.DisplayConfig.GetCurrentState',
    ],
    parse: parseMutterCurrentState,
  },
];

async function defaultRunCommand(command: string, args: string[]): Promise<string> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');

  const { stdout } = await promisify(execFile)(command, args, {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  return stdout;
}

/**
 * Ask each known compositor tool in turn, first answer wins.
 *
 * Asynchronous on purpose: this runs during backend init on the Electron main
 * thread, and three synchronous `execFileSync` calls would freeze the whole UI
 * for as long as the probes take.
 */
export async function detectWaylandScreenSize(
  run: CommandRunner = defaultRunCommand
): Promise<ScreenSize | null> {
  for (const probe of PROBES) {
    try {
      const size = probe.parse(await run(probe.command, probe.args));
      if (size) return size;
    } catch {
      // Tool not installed, not this compositor, or it timed out — try the next.
    }
  }

  return null;
}
