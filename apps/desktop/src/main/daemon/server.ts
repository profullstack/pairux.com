/**
 * `pairux --daemon`: start a screen-sharing session on this device on command.
 *
 * Lets you leave a laptop presenting and drive it from a phone — start the
 * session from the web app, join it from anywhere.
 *
 * Reachability is Tailscale's job, not ours. The server binds to loopback only
 * and is expected to be fronted by:
 *
 *     tailscale serve --bg https / http://127.0.0.1:17872
 *
 * which gives it a real certificate at https://<device>.<tailnet>.ts.net — the
 * PWA is served over HTTPS and browsers refuse to call a plain-HTTP address
 * from it, so the certificate is what makes this work at all — and injects
 * caller identity headers, so authentication comes from the tailnet rather than
 * a secret we would have to invent.
 *
 * Binding to loopback is deliberate: without `tailscale serve` in front, this
 * is unreachable from any other machine.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { startTailscaleServe, stopTailscaleServe, type TailscaleState } from './tailscale.js';

export const DEFAULT_DAEMON_PORT = 17872;

/** Origins allowed to drive this device. */
const ALLOWED_ORIGINS = new Set(['https://pairux.com', 'https://www.pairux.com']);

export interface DaemonHooks {
  /** Begin sharing and return the details needed to join. */
  startSession: () => Promise<{ sessionId: string; joinCode: string; url: string }>;
  stopSession: () => Promise<void>;
  getStatus: () => { sharing: boolean; sessionId: string | null; joinCode: string | null };
}

export interface DaemonOptions {
  port?: number;
  hooks: DaemonHooks;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  /**
   * Publish over the tailnet automatically (default true).
   *
   * Off leaves the daemon on loopback only, for local development.
   */
  publishToTailnet?: boolean;
  /**
   * Skip the tailnet identity check.
   *
   * Only for local development — without it any process on this machine can
   * start a screen share.
   */
  allowUnauthenticated?: boolean;
}

/**
 * Who is calling, according to Tailscale.
 *
 * `tailscale serve` sets these on every proxied request; their absence means
 * the request did not come through the tailnet, so it is refused.
 */
function tailscaleIdentity(req: IncomingMessage): string | null {
  const login = req.headers['tailscale-user-login'];
  if (typeof login === 'string' && login.length > 0) return login;
  return null;
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(payload)),
    // Never let a browser cache the state of a live device.
    'Cache-Control': 'no-store',
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }

  res.writeHead(status, headers);
  res.end(payload);
}

export class PairuxDaemon {
  private server: Server | null = null;
  private readonly port: number;
  private readonly hooks: DaemonHooks;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly allowUnauthenticated: boolean;
  private readonly publishToTailnet: boolean;
  private tailscale: TailscaleState | null = null;

  constructor(options: DaemonOptions) {
    this.port = options.port ?? DEFAULT_DAEMON_PORT;
    this.hooks = options.hooks;
    this.logger = options.logger ?? console;
    this.allowUnauthenticated = options.allowUnauthenticated ?? false;
    this.publishToTailnet = options.publishToTailnet ?? true;
  }

  /** Where a phone should point, once the tailnet mapping is up. */
  get publicUrl(): string | null {
    return this.tailscale?.url ?? null;
  }

  async start(): Promise<void> {
    if (this.server) return;

    const server = createServer((req, res) => {
      void this.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // Loopback only. Reachability is tailscale serve's job.
      server.listen(this.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.server = server;
    this.logger.log(`[Daemon] Listening on 127.0.0.1:${String(this.port)}`);

    if (!this.publishToTailnet) return;

    // Publish it ourselves rather than making the user paste a command.
    this.tailscale = await startTailscaleServe(this.port);

    if (this.tailscale.url) {
      this.logger.log(`[Daemon] Reachable on your tailnet at ${this.tailscale.url}`);
      this.logger.log('[Daemon] Open pairux.com on your phone and point it at that address.');
    } else {
      this.logger.warn(
        `[Daemon] Not published to the tailnet: ${this.tailscale.reason ?? 'unknown reason'}`
      );
      this.logger.warn('[Daemon] Still running, but only reachable from this machine.');
    }
  }

  async stop(): Promise<void> {
    if (this.publishToTailnet) {
      // Leave nothing published behind a stopped daemon.
      await stopTailscaleServe();
      this.tailscale = null;
    }

    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

    if (req.method === 'OPTIONS') {
      send(res, 204, {}, origin);
      return;
    }

    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      send(res, 403, { error: 'Origin not allowed' });
      return;
    }

    const identity = tailscaleIdentity(req);
    if (!identity && !this.allowUnauthenticated) {
      // No tailnet identity means the request did not arrive through
      // `tailscale serve`, so we have no idea who is asking.
      send(res, 401, { error: 'Not reachable through Tailscale' }, origin);
      return;
    }

    const path = (req.url ?? '/').split('?')[0];

    try {
      if (req.method === 'GET' && path === '/status') {
        send(res, 200, { ...this.hooks.getStatus(), identity }, origin);
        return;
      }

      if (req.method === 'POST' && path === '/session/start') {
        this.logger.log('[Daemon] Session start requested', { identity });
        const session = await this.hooks.startSession();
        send(res, 200, session, origin);
        return;
      }

      if (req.method === 'POST' && path === '/session/stop') {
        this.logger.log('[Daemon] Session stop requested', { identity });
        await this.hooks.stopSession();
        send(res, 200, { stopped: true }, origin);
        return;
      }

      send(res, 404, { error: 'Not found' }, origin);
    } catch (error) {
      this.logger.error('[Daemon] Request failed', error);
      send(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' }, origin);
    }
  }
}
