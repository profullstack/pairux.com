/**
 * Daemon mode wiring: `pairux --daemon`.
 *
 * The renderer owns capture and session creation, so main keeps a cached copy
 * of what it reports and answers the HTTP endpoints from that. Reporting state
 * rather than answering questions avoids a request/response correlation
 * protocol across IPC for something the renderer already knows continuously.
 *
 * On Wayland capture cannot start without the portal picker, which needs a
 * person at the machine. So the daemon takes that grant once at startup and the
 * phone starts sessions against it — `/session/start` returns the live session
 * when there is one rather than trying to begin a capture nobody can approve.
 */

import type { BrowserWindow } from 'electron';
import { PairuxDaemon, DEFAULT_DAEMON_PORT } from './server.js';

export interface DaemonSessionState {
  sharing: boolean;
  sessionId: string | null;
  joinCode: string | null;
  url: string | null;
}

const EMPTY: DaemonSessionState = { sharing: false, sessionId: null, joinCode: null, url: null };

/** How long to wait for the renderer to get a session up. */
const START_TIMEOUT_MS = 60_000;

let state: DaemonSessionState = { ...EMPTY };
let daemon: PairuxDaemon | null = null;
const waiters = new Set<(value: DaemonSessionState) => void>();

/** Called from IPC whenever the renderer's sharing state changes. */
export function reportDaemonState(next: DaemonSessionState): void {
  state = next;
  if (!next.sharing) return;

  for (const resolve of waiters) resolve(next);
  waiters.clear();
}

function waitForSharing(): Promise<DaemonSessionState> {
  if (state.sharing) return Promise.resolve(state);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(onState);
      reject(
        new Error(
          'Timed out waiting for the session to start. On Wayland the screen-capture ' +
            'prompt must be accepted on the device itself.'
        )
      );
    }, START_TIMEOUT_MS);

    function onState(value: DaemonSessionState): void {
      clearTimeout(timer);
      resolve(value);
    }

    waiters.add(onState);
  });
}

export async function startDaemon(
  getWindow: () => BrowserWindow | null,
  port = DEFAULT_DAEMON_PORT
): Promise<PairuxDaemon> {
  daemon ??= new PairuxDaemon({
    port,
    hooks: {
      getStatus: () => ({
        sharing: state.sharing,
        sessionId: state.sessionId,
        joinCode: state.joinCode,
      }),

      startSession: async () => {
        // Already sharing: hand back the live session rather than starting a
        // second one.
        if (!state.sharing) {
          getWindow()?.webContents.send('daemon:start-session');
        }

        const ready = await waitForSharing();
        if (!ready.sessionId || !ready.joinCode) {
          throw new Error('Session started but produced no join code');
        }

        return {
          sessionId: ready.sessionId,
          joinCode: ready.joinCode,
          url: ready.url ?? `https://pairux.com/join/${ready.joinCode}`,
        };
      },

      stopSession: async () => {
        getWindow()?.webContents.send('daemon:stop-session');
        state = { ...EMPTY };
        return Promise.resolve();
      },
    },
  });

  await daemon.start();
  return daemon;
}

export async function stopDaemon(): Promise<void> {
  await daemon?.stop();
  daemon = null;
  state = { ...EMPTY };
  waiters.clear();
}

/** Test seam. */
export function resetDaemonState(): void {
  state = { ...EMPTY };
  waiters.clear();
}
