#!/usr/bin/env node
/**
 * pairux — bring an AI agent into a live PairUX session as a participant.
 *
 *   pairux login                 sign in (browser, OAuth 2.1 + PKCE)
 *   pairux join ABC123 --name "Claude"
 *   pairux listen                follow chat + roster (stays present)
 *   pairux say "Tests pass on my side"
 *   pairux who                   who is in the session
 *   pairux leave
 *
 * Every command takes its I/O through `Deps`, so tests drive it end to end
 * against a fake server without touching the network, the terminal or ~/.
 */
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  apiUrl as resolveApiUrl,
  configPath as defaultConfigPath,
  loadConfig,
  saveConfig,
  type CliConfig,
} from './config.js';
import {
  AuthError,
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  listenForCallback,
  needsRefresh,
  openBrowser as defaultOpenBrowser,
  randomState,
  refresh,
  revoke,
} from './auth.js';
import { ApiError, PairuxClient, type ChatMessage, type RosterEntry } from './api.js';

export const VERSION = '0.1.0';
const MAX_MESSAGE = 500;

export interface Deps {
  env: NodeJS.ProcessEnv;
  configPath: string;
  fetchImpl: typeof fetch;
  out: (line: string) => void;
  err: (line: string) => void;
  openBrowser: (url: string) => void;
  sleep: (ms: number) => Promise<void>;
  readStdin: () => Promise<string | null>;
  /** Tests stop `listen` after N polls; production runs until 410 or Ctrl-C. */
  maxPolls?: number;
  login?: typeof listenForCallback;
}

const HELP = `pairux ${VERSION}: bring AI agents into PairUX sessions

Usage:
  pairux login [--no-browser]        Sign in so your agents are labelled as yours
  pairux logout                      Sign out and revoke this computer's tokens
  pairux whoami                      Show who the CLI is signed in as
  pairux join <CODE> [options]       Join a session as an agent
      --name <name>                  Display name (default: "Claude Code" or "PairUX Agent")
      --client <slug>                What the agent is, e.g. claude-code, moshcode
      --anonymous                    Join without your account even if signed in
      --force                        Replace an agent this CLI is already running
  pairux listen [--json] [--interval <s>] [--once] [--all]
                                     Print new chat messages and roster changes.
                                     Keeps the agent present; stops when removed.
  pairux say <message...>            Post in the session chat ("-" reads stdin)
  pairux who [--json]                List who is in the session
  pairux status [--json]             Show the agent this CLI is running as
  pairux leave                       Leave the session

Environment:
  PAIRUX_API_URL        default https://pairux.com
  PAIRUX_AGENT_NAME     default display name for join
  PAIRUX_AGENT_CLIENT   default --client for join
  PAIRUX_CONFIG_DIR     where config.json lives (default ~/.config/pairux)

Agents watch and chat. They cannot see or control anyone's screen, and the
host can remove them at any time. Docs: https://pairux.com/docs/agents`;

function defaultName(env: NodeJS.ProcessEnv): string {
  if (env.PAIRUX_AGENT_NAME) return env.PAIRUX_AGENT_NAME;
  return env.CLAUDECODE ? 'Claude Code' : 'PairUX Agent';
}

function defaultClient(env: NodeJS.ProcessEnv): string | undefined {
  if (env.PAIRUX_AGENT_CLIENT) return env.PAIRUX_AGENT_CLIENT;
  return env.CLAUDECODE ? 'claude-code' : undefined;
}

function time(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function describe(p: RosterEntry): string {
  const tags = [p.role === 'host' ? 'host' : null, p.kind === 'agent' ? 'agent' : null]
    .filter(Boolean)
    .join(', ');
  const client = p.agent_client ? ` · ${p.agent_client}` : '';
  return `${p.display_name}${tags ? ` (${tags}${client})` : ''}`;
}

class UsageError extends Error {}

export async function run(argv: string[], deps: Deps): Promise<number> {
  const [command, ...rest] = argv;
  let config: CliConfig = await loadConfig(deps.configPath);
  const api = resolveApiUrl(config, deps.env);
  const persist = async (next: CliConfig) => {
    config = next;
    await saveConfig(config, deps.configPath);
  };

  const getAccessToken = async (): Promise<string | null> => {
    const tokens = config.tokens;
    if (!tokens) return null;
    if (!needsRefresh(tokens)) return tokens.accessToken;
    try {
      const fresh = await refresh(api, tokens.refreshToken, deps.fetchImpl);
      await persist({ ...config, tokens: fresh });
      return fresh.accessToken;
    } catch (error) {
      if (error instanceof AuthError) {
        const { tokens: _dropped, ...rest } = config;
        await persist(rest);
        deps.err(`Your sign-in expired (${error.message}). Run \`pairux login\` again.`);
        return null;
      }
      throw error;
    }
  };

  const client = new PairuxClient({
    apiUrl: api,
    getAccessToken,
    fetchImpl: deps.fetchImpl,
    userAgent: `pairux-cli/${VERSION}`,
  });

  const requireAgent = () => {
    if (!config.agent) throw new UsageError('Not in a session. Run `pairux join <CODE>` first.');
    return config.agent;
  };

  try {
    switch (command) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        deps.out(HELP);
        return 0;

      case 'version':
      case '--version':
      case '-v':
        deps.out(VERSION);
        return 0;

      case 'login': {
        const { values } = parseArgs({
          args: rest,
          options: { 'no-browser': { type: 'boolean', default: false } },
        });
        const pkce = createPkce();
        const state = randomState();
        const loopback = await (deps.login ?? listenForCallback)();
        try {
          const url = buildAuthorizeUrl(api, {
            challenge: pkce.challenge,
            redirectUri: loopback.redirectUri,
            state,
            clientName: 'PairUX CLI',
          });
          deps.out('Opening your browser to sign in. If it does not open, visit:');
          deps.out(url);
          if (!values['no-browser']) deps.openBrowser(url);
          const code = await loopback.waitForCode(state);
          const tokens = await exchangeCode(
            api,
            { code, verifier: pkce.verifier, redirectUri: loopback.redirectUri },
            deps.fetchImpl
          );
          await persist({ ...config, tokens });
        } finally {
          loopback.close();
        }
        const me = await client.me();
        deps.out(`Signed in as ${me.displayName ?? me.username ?? me.userId}.`);
        return 0;
      }

      case 'logout': {
        if (config.tokens) await revoke(api, config.tokens.refreshToken, deps.fetchImpl);
        const { tokens: _dropped, ...rest2 } = config;
        await persist(rest2);
        deps.out('Signed out.');
        return 0;
      }

      case 'whoami': {
        if (!config.tokens) {
          deps.out(
            'Not signed in. Agents you start join anonymously; run `pairux login` to label them as yours.'
          );
          return 1;
        }
        const me = await client.me();
        deps.out(
          `${me.displayName ?? me.username ?? me.userId}${me.username ? ` (@${me.username})` : ''}`
        );
        return 0;
      }

      case 'join': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            name: { type: 'string' },
            client: { type: 'string' },
            anonymous: { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
          },
        });
        const joinCode = positionals[0]?.trim().toUpperCase();
        if (!joinCode || !/^[A-Z0-9]{6}$/.test(joinCode)) {
          throw new UsageError('Usage: pairux join <CODE>  (the 6-character join code)');
        }
        if (config.agent && !values.force) {
          throw new UsageError(
            `Already in session ${config.agent.joinCode} as ${config.agent.displayName}. Run \`pairux leave\` first, or pass --force.`
          );
        }
        if (config.agent && values.force) {
          await client.leave(config.agent.participantId).catch(() => undefined);
        }
        const clientSlug = values.client ?? defaultClient(deps.env);
        const signedIn = Boolean(config.tokens) && !values.anonymous;
        const joined = await client.join(
          {
            joinCode,
            name: values.name ?? defaultName(deps.env),
            ...(clientSlug ? { client: clientSlug } : {}),
          },
          signedIn
        );
        await persist({
          ...config,
          agent: {
            participantId: joined.participantId,
            sessionId: joined.sessionId,
            joinCode,
            displayName: joined.displayName,
          },
        });
        deps.out(
          `Joined ${joinCode} as ${joined.displayName}${joined.owned ? ' (your agent)' : ' (anonymous agent)'}.`
        );
        deps.out('Run `pairux listen` to follow the chat and stay present.');
        return 0;
      }

      case 'say': {
        const agent = requireAgent();
        let message = rest.join(' ').trim();
        if (message === '-' || (message === '' && !process.stdin.isTTY)) {
          message = ((await deps.readStdin()) ?? '').trim();
        }
        if (!message) throw new UsageError('Usage: pairux say <message>');
        if (message.length > MAX_MESSAGE) {
          throw new UsageError(
            `Messages are limited to ${String(MAX_MESSAGE)} characters (got ${String(message.length)}).`
          );
        }
        await client.say(agent.participantId, message);
        return 0;
      }

      case 'who':
      case 'status': {
        const { values } = parseArgs({
          args: rest,
          options: { json: { type: 'boolean', default: false } },
        });
        const agent = requireAgent();
        // A poll with `after` set to now returns the roster but no backlog.
        const result = await client.poll(agent.participantId, new Date().toISOString());
        if (values.json) {
          deps.out(
            JSON.stringify(
              command === 'who' ? result.participants : { you: result.you, session: result.session }
            )
          );
          return 0;
        }
        if (command === 'status') {
          deps.out(
            `${result.you.displayName} in ${result.session.joinCode}${result.session.subject ? ` (${result.session.subject})` : ''}, session ${result.session.status}.`
          );
          return 0;
        }
        for (const p of result.participants) {
          deps.out(`${p.id === result.you.id ? '* ' : '  '}${describe(p)}`);
        }
        return 0;
      }

      case 'listen': {
        const { values } = parseArgs({
          args: rest,
          options: {
            json: { type: 'boolean', default: false },
            interval: { type: 'string', default: '3' },
            once: { type: 'boolean', default: false },
            all: { type: 'boolean', default: false },
          },
        });
        const agent = requireAgent();
        const intervalMs = Math.max(1, Number(values.interval) || 3) * 1000;
        let cursor = values.all ? undefined : agent.cursor;
        let roster: Map<string, RosterEntry> | null = null;
        let polls = 0;

        const emitMessage = (m: ChatMessage) => {
          if (values.json) deps.out(JSON.stringify({ type: 'message', ...m }));
          else deps.out(`[${time(m.created_at)}] ${m.display_name}: ${m.content}`);
        };
        const emitRoster = (type: 'joined' | 'left', p: RosterEntry) => {
          if (values.json) deps.out(JSON.stringify({ type, participant: p }));
          else deps.out(`* ${describe(p)} ${type}`);
        };

        for (;;) {
          let result;
          try {
            result = await client.poll(agent.participantId, cursor);
          } catch (error) {
            if (error instanceof ApiError && error.gone) {
              const { agent: _gone, ...rest3 } = config;
              await persist(rest3);
              if (values.json) deps.out(JSON.stringify({ type: 'ended', reason: error.message }));
              else deps.out(`* ${error.message}`);
              return 0;
            }
            throw error;
          }

          for (const m of result.messages) emitMessage(m);
          const last = result.messages[result.messages.length - 1];
          if (last) cursor = last.created_at;
          else cursor ??= result.serverTime;

          const next = new Map(result.participants.map((p) => [p.id, p]));
          if (roster) {
            for (const [id, p] of next) if (!roster.has(id)) emitRoster('joined', p);
            for (const [id, p] of roster) if (!next.has(id)) emitRoster('left', p);
          }
          roster = next;

          if (cursor !== agent.cursor) {
            agent.cursor = cursor;
            await persist({ ...config, agent });
          }

          polls += 1;
          if (values.once || (deps.maxPolls !== undefined && polls >= deps.maxPolls)) return 0;
          await deps.sleep(intervalMs);
        }
      }

      case 'leave': {
        const agent = requireAgent();
        await client.leave(agent.participantId).catch((error: unknown) => {
          if (!(error instanceof ApiError && (error.status === 404 || error.gone))) throw error;
        });
        const { agent: _left, ...rest4 } = config;
        await persist(rest4);
        deps.out(`Left ${agent.joinCode}.`);
        return 0;
      }

      default:
        throw new UsageError(`Unknown command "${command}". Run \`pairux help\`.`);
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof AuthError) {
      deps.err(error.message);
      return 2;
    }
    if (error instanceof ApiError) {
      deps.err(`PairUX: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && error.name === 'TypeError' && 'code' in error) {
      deps.err(`Unknown option: ${error.message}`);
      return 2;
    }
    deps.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function readAllStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const code = await run(process.argv.slice(2), {
    env: process.env,
    configPath: defaultConfigPath(),
    fetchImpl: fetch,
    out: (line) => {
      process.stdout.write(line + '\n');
    },
    err: (line) => {
      process.stderr.write(line + '\n');
    },
    openBrowser: defaultOpenBrowser,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readStdin: readAllStdin,
  });
  process.exitCode = code;
}
