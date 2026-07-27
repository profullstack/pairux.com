import { describe, it, expect, afterEach, vi } from 'vitest';
import { PairuxDaemon, DEFAULT_DAEMON_PORT } from './server';

const silent = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function hooks() {
  return {
    startSession: vi.fn().mockResolvedValue({
      sessionId: 's-1',
      joinCode: 'ABC123',
      url: 'https://pairux.com/join/ABC123',
    }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ sharing: false, sessionId: null, joinCode: null }),
  };
}

// A spare port so the suite never fights a real daemon.
const PORT = 17931;

describe('PairuxDaemon', () => {
  let daemon: PairuxDaemon | null = null;

  afterEach(async () => {
    await daemon?.stop();
    daemon = null;
  });

  async function serve(overrides: Partial<ConstructorParameters<typeof PairuxDaemon>[0]> = {}) {
    const h = hooks();
    daemon = new PairuxDaemon({
      port: PORT,
      hooks: h,
      logger: silent,
      publishToTailnet: false,
      ...overrides,
    });
    await daemon.start();
    return h;
  }

  const url = (path: string) => `http://127.0.0.1:${String(PORT)}${path}`;
  const tailnet = { 'tailscale-user-login': 'someone@example.com' };

  it('defaults to a fixed port so tailscale serve can be documented', () => {
    expect(DEFAULT_DAEMON_PORT).toBe(17872);
  });

  // The only thing standing between the open internet and "start sharing my
  // screen" is that this request came through the tailnet.
  it('refuses a request with no tailnet identity', async () => {
    const h = await serve();

    const res = await fetch(url('/session/start'), { method: 'POST' });

    expect(res.status).toBe(401);
    expect(h.startSession).not.toHaveBeenCalled();
  });

  it('starts a session for a caller Tailscale vouches for', async () => {
    const h = await serve();

    const res = await fetch(url('/session/start'), { method: 'POST', headers: tailnet });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ joinCode: 'ABC123' });
    expect(h.startSession).toHaveBeenCalled();
  });

  it('reports status', async () => {
    await serve();

    const res = await fetch(url('/status'), { headers: tailnet });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sharing: false, identity: 'someone@example.com' });
  });

  it('stops a session', async () => {
    const h = await serve();

    const res = await fetch(url('/session/stop'), { method: 'POST', headers: tailnet });

    expect(res.status).toBe(200);
    expect(h.stopSession).toHaveBeenCalled();
  });

  // Any site could otherwise ask a visitor's browser to start sharing.
  it('refuses an origin that is not the PairUX web app', async () => {
    const h = await serve();

    const res = await fetch(url('/session/start'), {
      method: 'POST',
      headers: { ...tailnet, origin: 'https://evil.example' },
    });

    expect(res.status).toBe(403);
    expect(h.startSession).not.toHaveBeenCalled();
  });

  it('allows the PairUX web app and echoes CORS for it', async () => {
    await serve();

    const res = await fetch(url('/session/start'), {
      method: 'POST',
      headers: { ...tailnet, origin: 'https://pairux.com' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://pairux.com');
  });

  it('surfaces a failure to start rather than hanging', async () => {
    const h = hooks();
    h.startSession.mockRejectedValue(new Error('no capture permission'));
    daemon = new PairuxDaemon({ port: PORT, hooks: h, logger: silent, publishToTailnet: false });
    await daemon.start();

    const res = await fetch(url('/session/start'), { method: 'POST', headers: tailnet });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'no capture permission' });
  });
});
