/**
 * Where the CLI keeps its state: the OAuth tokens from `pairux login` and the
 * agent it is currently running as (from `pairux join`). One JSON file, mode
 * 0600, under $PAIRUX_CONFIG_DIR, $XDG_CONFIG_HOME/pairux or ~/.config/pairux.
 */
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_API_URL = 'https://pairux.com';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
}

export interface StoredAgent {
  participantId: string;
  sessionId: string;
  joinCode: string;
  displayName: string;
  /** created_at of the newest chat message already shown by `listen`. */
  cursor?: string;
}

export interface CliConfig {
  apiUrl?: string;
  tokens?: StoredTokens;
  agent?: StoredAgent;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PAIRUX_CONFIG_DIR) return join(env.PAIRUX_CONFIG_DIR, 'config.json');
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'pairux', 'config.json');
}

export function apiUrl(config: CliConfig, env: NodeJS.ProcessEnv = process.env): string {
  let url = env.PAIRUX_API_URL ?? config.apiUrl ?? DEFAULT_API_URL;
  // Trim trailing slashes without a regex (a /\/+$/ backtracks on long runs).
  while (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

export async function loadConfig(path = configPath()): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CliConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Could not read ${path}: ${(error as Error).message}`);
  }
}

export async function saveConfig(config: CliConfig, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  // writeFile's mode only applies on create; tighten an existing file too.
  await chmod(path, 0o600);
}

export async function clearConfig(path = configPath()): Promise<void> {
  await rm(path, { force: true });
}
