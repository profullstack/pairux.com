/**
 * Reads the pointer position on KDE/Wayland.
 *
 * Wayland deliberately refuses to tell a client where the pointer is, which
 * leaves remote control unable to hand the local user's pointer back after
 * borrowing it for a click. Only the compositor knows, so we ask KWin.
 *
 * KWin scripts can only talk *outward* over DBus (`callDBus`), and the session
 * bus rejects calls to a name nobody owns — so this owns a name and exposes a
 * method the script pushes into. The script is installed and loaded
 * automatically, so the user does nothing.
 *
 * Everything here fails soft: if glib's gdbus is missing, KWin refuses the
 * script, or the DBus name cannot be claimed, `getPosition()` simply returns
 * null and callers fall back to not restoring the pointer.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const DBUS_NAME = 'org.profullstack.RemoteInput';
const DBUS_PATH = '/org/profullstack/RemoteInput';
const SCRIPT_NAME = 'pairux-cursor-reporter';

/** Ignore a stale reading rather than restoring the pointer somewhere wrong. */
const POSITION_MAX_AGE_MS = 2000;

/**
 * KWin scripting has lived at two interface names; try both rather than
 * pinning to one KWin generation.
 */
const SCRIPTING_INTERFACES = ['org.kde.kwin.Scripting', 'org.kde.KWin.Scripting'];

/**
 * Pushes the pointer position to us whenever it moves far enough to matter.
 *
 * Throttled by distance because the signal fires on every motion event and we
 * only need a position accurate enough to restore to — not a full motion feed.
 */
export function buildKWinScript(): string {
  return `// Installed by PairUX. Reports the pointer position so remote control can
// hand the local pointer back after borrowing it for a click.
var lastX = -99999;
var lastY = -99999;

function report() {
  var p = workspace.cursorPos;
  if (Math.abs(p.x - lastX) < 6 && Math.abs(p.y - lastY) < 6) {
    return;
  }
  lastX = p.x;
  lastY = p.y;
  callDBus(
    '${DBUS_NAME}',
    '${DBUS_PATH}',
    '${DBUS_NAME}',
    'SetCursorPos',
    Math.round(p.x),
    Math.round(p.y)
  );
}

report();

if (typeof workspace.cursorPosChanged !== 'undefined') {
  workspace.cursorPosChanged.connect(report);
  print('pairux: cursor reporter attached to cursorPosChanged');
} else {
  // Older/newer API without the notify signal: fall back to signals that at
  // least fire during ordinary use, so the reading is refreshed sometimes.
  print('pairux: cursorPosChanged unavailable, falling back to window signals');
  if (typeof workspace.windowActivated !== 'undefined') {
    workspace.windowActivated.connect(report);
  }
  if (typeof workspace.currentDesktopChanged !== 'undefined') {
    workspace.currentDesktopChanged.connect(report);
  }
}
`;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // gdbus puts the useful part on stderr.
    const stderr = (error as Error & { stderr?: string }).stderr;
    return (stderr ?? error.message).trim().split('\n')[0] ?? 'unknown error';
  }
  return String(error);
}

interface Logger {
  log: (message: string, ...rest: unknown[]) => void;
  warn: (message: string, ...rest: unknown[]) => void;
}

export interface KWinCursorProviderOptions {
  logger?: Logger;
}

export class KWinCursorProvider {
  private position: { x: number; y: number; at: number } | null = null;
  private started = false;
  private available = false;
  private bus: { disconnect: () => void } | null = null;
  private readonly logger: Logger;

  constructor(options: KWinCursorProviderOptions = {}) {
    this.logger = options.logger ?? console;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Idempotent; safe to call even where none of this can work. */
  async start(): Promise<boolean> {
    if (this.started) return this.available;
    this.started = true;

    try {
      await this.serveDBus();
    } catch (error) {
      this.logger.warn(
        '[RemoteInput] Cursor reporting off: could not claim the DBus name ' +
          `(${describe(error)}). Remote clicks will leave the pointer where they land.`
      );
      return false;
    }

    try {
      const scriptPath = await this.writeScript();
      await this.loadScript(scriptPath);
    } catch (error) {
      this.logger.warn(
        `[RemoteInput] Cursor reporting off: KWin would not load the helper (${describe(error)}). ` +
          'Remote clicks will leave the pointer where they land.'
      );
      return false;
    }

    this.available = true;
    this.logger.log('[RemoteInput] KWin cursor reporting active');
    return true;
  }

  /**
   * Latest pointer position in device pixels, or null when unknown or stale.
   *
   * Callers normalize; this provider has no view of the screen size.
   */
  getPosition(): { x: number; y: number } | null {
    if (!this.position) return null;
    if (Date.now() - this.position.at > POSITION_MAX_AGE_MS) return null;
    return { x: this.position.x, y: this.position.y };
  }

  async stop(): Promise<void> {
    for (const iface of SCRIPTING_INTERFACES) {
      try {
        await this.callScripting(iface, 'unloadScript', [SCRIPT_NAME]);
        break;
      } catch {
        // Nothing loaded, or a different KWin generation — either is fine.
      }
    }

    this.bus?.disconnect();
    this.bus = null;
    this.available = false;
    this.started = false;
  }

  private async serveDBus(): Promise<void> {
    // Optional dependency: absent on a server install, present on a desktop.
    const dbus = (await import('dbus-next')) as unknown as {
      sessionBus: () => {
        requestName: (name: string, flags?: number) => Promise<unknown>;
        export: (path: string, iface: unknown) => void;
        disconnect: () => void;
      };
      interface: {
        Interface: new (name: string) => object;
      };
    };

    const { Interface } = dbus.interface;
    const record = (x: number, y: number): void => {
      this.position = { x, y, at: Date.now() };
    };

    class CursorInterface extends Interface {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      SetCursorPos(x: number, y: number): void {
        record(x, y);
      }
    }

    (
      CursorInterface as unknown as {
        configureMembers: (config: unknown) => void;
      }
    ).configureMembers({
      methods: {
        SetCursorPos: { inSignature: 'ii', outSignature: '' },
      },
    });

    const bus = dbus.sessionBus();
    await bus.requestName(DBUS_NAME);
    bus.export(DBUS_PATH, new CursorInterface(DBUS_NAME));
    this.bus = bus;
  }

  private async writeScript(): Promise<string> {
    const base =
      process.env.XDG_DATA_HOME ?? (homedir() ? join(homedir(), '.local', 'share') : tmpdir());
    const dir = join(base, 'pairux');
    await fs.mkdir(dir, { recursive: true });

    const scriptPath = join(dir, `${SCRIPT_NAME}.js`);
    await fs.writeFile(scriptPath, buildKWinScript(), 'utf8');
    return scriptPath;
  }

  private async loadScript(scriptPath: string): Promise<void> {
    let lastError: unknown = null;

    for (const iface of SCRIPTING_INTERFACES) {
      try {
        // Replace any copy left behind by an earlier run.
        try {
          await this.callScripting(iface, 'unloadScript', [SCRIPT_NAME]);
        } catch {
          // Usually "not loaded" — expected on a clean start.
        }

        await this.callScripting(iface, 'loadScript', [scriptPath, SCRIPT_NAME]);
        await this.callScripting(iface, 'start', []);
        this.logger.log('[RemoteInput] KWin cursor reporter loaded', { iface, scriptPath });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`KWin scripting interface not reachable: ${describe(lastError)}`);
  }

  private async callScripting(iface: string, method: string, args: string[]): Promise<string> {
    const { stdout } = await run(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.kde.KWin',
        '--object-path',
        '/Scripting',
        '--method',
        `${iface}.${method}`,
        ...args,
      ],
      { timeout: 5000 }
    );
    return stdout.trim();
  }
}
