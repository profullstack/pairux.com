/**
 * `pairux login|logout|whoami|join|listen|say|who|status|leave`
 *
 * The installed `pairux` launcher passes any argument it does not handle
 * itself (update, uninstall, --help, --version) straight to the app, the same
 * way `pairux daemon` works. When the first real argument is one of these
 * agent commands, the main process runs it headless, prints to the terminal
 * and exits: no window, no tray, no single-instance hand-off.
 */
import { configPath } from './config';
import { openBrowser } from './auth';
import { readAllStdin, run } from './commands';

export const AGENT_COMMANDS = new Set([
  'login',
  'logout',
  'whoami',
  'join',
  'listen',
  'say',
  'who',
  'status',
  'leave',
]);

/**
 * The agent command and its arguments, or null when the app should start
 * normally. Packaged argv is [exe, ...args]; in dev it is [electron, '.', ...].
 * Chromium/Electron switches (`--no-sandbox`, `--ozone-platform=...`) that a
 * wrapper may prepend are skipped.
 */
export function parseAgentArgv(argv: string[], isPackaged: boolean): string[] | null {
  const args = argv.slice(isPackaged ? 1 : 2);
  const first = args.findIndex((a) => !a.startsWith('--'));
  if (first === -1) return null;
  const command = args[first];
  if (!command || !AGENT_COMMANDS.has(command)) return null;
  return args.slice(first);
}

export function runAgentCommand(args: string[], version: string): Promise<number> {
  return run(args, {
    env: process.env,
    configPath: configPath(),
    fetchImpl: fetch,
    out: (line) => {
      process.stdout.write(line + '\n');
    },
    err: (line) => {
      process.stderr.write(line + '\n');
    },
    openBrowser,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readStdin: readAllStdin,
    version,
  });
}
