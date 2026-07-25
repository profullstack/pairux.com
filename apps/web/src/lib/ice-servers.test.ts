import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolve4 = vi.fn();

vi.mock('node:dns', () => {
  const promises = { resolve4: (...args: unknown[]) => resolve4(...args) };
  return { promises, default: { promises } };
});

const ENV_KEYS = [
  'TURN_SERVER_USERNAME',
  'TURN_SERVER_CREDENTIAL',
  'TURN_SERVER_URL',
  'TURNS_SERVER_URL',
  'TURN_SERVER_IP_URL',
  'TURNS_SERVER_IP_URL',
  'NEXT_PUBLIC_TURN_URL',
  'NEXT_PUBLIC_TURNS_URL',
  'NEXT_PUBLIC_TURN_IP_URL',
  'NEXT_PUBLIC_TURN_USERNAME',
  'NEXT_PUBLIC_TURN_CREDENTIAL',
];

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    process.env[key] = undefined;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete process.env[key];
  }
}

function flatUrls(servers: { urls: string | string[] }[]): string[] {
  return servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
}

// Import fresh each time so the module-level resolution cache does not leak.
async function loadGetIceServers() {
  vi.resetModules();
  const mod = await import('./ice-servers');
  return mod.getIceServers;
}

describe('getIceServers', () => {
  beforeEach(() => {
    clearEnv();
    resolve4.mockReset();
  });

  afterEach(clearEnv);

  it('always offers STUN', async () => {
    const getIceServers = await loadGetIceServers();
    const urls = flatUrls(await getIceServers());
    expect(urls).toContain('stun:stun.l.google.com:19302');
  });

  it('omits TURN when credentials are absent', async () => {
    process.env.TURN_SERVER_URL = 'turn:turn.pairux.com:3478';
    const getIceServers = await loadGetIceServers();
    const servers = await getIceServers();
    expect(servers.every((s) => s.username === undefined)).toBe(true);
  });

  // Clients on ISPs with unreliable resolvers fail to look up the TURN
  // hostname themselves and end up with no relay at all, so the server (whose
  // resolver works) hands them an address that needs no DNS.
  it('adds a server-resolved raw-IP relay alongside the hostname', async () => {
    process.env.TURN_SERVER_URL = 'turn:turn.pairux.com:3478';
    process.env.TURN_SERVER_USERNAME = 'user';
    process.env.TURN_SERVER_CREDENTIAL = 'secret';
    resolve4.mockResolvedValue(['203.0.113.10']);

    const getIceServers = await loadGetIceServers();
    const urls = flatUrls(await getIceServers());

    expect(urls).toContain('turn:turn.pairux.com:3478');
    expect(urls).toContain('turn:203.0.113.10:3478?transport=udp');
  });

  it('falls back to the hostname when resolution fails', async () => {
    process.env.TURN_SERVER_URL = 'turn:turn.pairux.com:3478';
    process.env.TURN_SERVER_USERNAME = 'user';
    process.env.TURN_SERVER_CREDENTIAL = 'secret';
    resolve4.mockRejectedValue(new Error('ENOTFOUND'));

    const getIceServers = await loadGetIceServers();
    const urls = flatUrls(await getIceServers());

    expect(urls).toContain('turn:turn.pairux.com:3478');
    expect(urls.some((u) => u.includes('203.0.113'))).toBe(false);
  });

  it('does not resolve when an explicit IP relay is configured', async () => {
    process.env.TURN_SERVER_URL = 'turn:turn.pairux.com:3478';
    process.env.TURN_SERVER_IP_URL = 'turn:198.51.100.7:3478';
    process.env.TURN_SERVER_USERNAME = 'user';
    process.env.TURN_SERVER_CREDENTIAL = 'secret';

    const getIceServers = await loadGetIceServers();
    const urls = flatUrls(await getIceServers());

    expect(urls).toContain('turn:198.51.100.7:3478');
    expect(resolve4).not.toHaveBeenCalled();
  });

  // A turns: URL against an IP literal fails certificate validation, so the
  // resolved form must stay plain turn:.
  it('never emits turns: for the resolved address', async () => {
    process.env.NEXT_PUBLIC_TURNS_URL = 'turns:turn.pairux.com:5349';
    process.env.TURN_SERVER_URL = 'turn:turn.pairux.com:3478';
    process.env.TURN_SERVER_USERNAME = 'user';
    process.env.TURN_SERVER_CREDENTIAL = 'secret';
    resolve4.mockResolvedValue(['203.0.113.10']);

    const getIceServers = await loadGetIceServers();
    const urls = flatUrls(await getIceServers());

    expect(urls).toContain('turn:203.0.113.10:3478?transport=udp');
    expect(urls.some((u) => u.startsWith('turns:') && /\d+\.\d+\.\d+\.\d+/.test(u))).toBe(false);
  });

  it('reuses a resolved address rather than looking it up per request', async () => {
    process.env.TURN_SERVER_URL = 'turn:turn.pairux.com:3478';
    process.env.TURN_SERVER_USERNAME = 'user';
    process.env.TURN_SERVER_CREDENTIAL = 'secret';
    resolve4.mockResolvedValue(['203.0.113.10']);

    const getIceServers = await loadGetIceServers();
    await getIceServers();
    await getIceServers();

    expect(resolve4).toHaveBeenCalledTimes(1);
  });
});
