import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeDeviceUrl,
  deviceNameFromUrl,
  describeDeviceError,
  loadDevices,
  saveDevices,
  startDeviceSession,
  getDeviceStatus,
} from './devices';

describe('normalizeDeviceUrl', () => {
  // People paste whatever they have: the bare hostname from `tailscale status`,
  // the full URL the daemon logs, with or without a trailing slash.
  it('accepts a bare tailnet hostname', () => {
    expect(normalizeDeviceUrl('bonita.tailnet-1234.ts.net')).toBe(
      'https://bonita.tailnet-1234.ts.net'
    );
  });

  it('accepts a full URL and strips any path', () => {
    expect(normalizeDeviceUrl('https://bonita.tailnet-1234.ts.net/status')).toBe(
      'https://bonita.tailnet-1234.ts.net'
    );
    expect(normalizeDeviceUrl('  https://bonita.ts.net/  ')).toBe('https://bonita.ts.net');
  });

  it('rejects input that is not a host', () => {
    expect(normalizeDeviceUrl('')).toBeNull();
    expect(normalizeDeviceUrl('   ')).toBeNull();
    expect(normalizeDeviceUrl('bonita')).toBeNull();
  });
});

describe('deviceNameFromUrl', () => {
  it('suggests the short device name', () => {
    expect(deviceNameFromUrl('https://bonita.tailnet-1234.ts.net')).toBe('bonita');
  });
});

describe('describeDeviceError', () => {
  // "Failed to fetch" tells a user nothing; not being on the tailnet is the
  // overwhelmingly common cause and worth naming.
  it('explains the usual cause of an unreachable device', () => {
    expect(describeDeviceError(new TypeError('Failed to fetch'))).toMatch(/same tailnet/i);
  });

  it('distinguishes identity, origin and device-side failures', () => {
    expect(describeDeviceError(null, 401)).toMatch(/tailnet/i);
    expect(describeDeviceError(null, 403)).toMatch(/pairux\.com/i);
    expect(describeDeviceError(null, 500)).toMatch(/prompt on the device/i);
  });
});

describe('device storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    });
  });

  it('round-trips devices', () => {
    saveDevices([{ id: '1', name: 'bonita', url: 'https://bonita.ts.net' }]);
    expect(loadDevices()).toEqual([{ id: '1', name: 'bonita', url: 'https://bonita.ts.net' }]);
  });

  it('survives corrupt storage rather than breaking the page', () => {
    localStorage.setItem('pairux-devices', '{not json');
    expect(loadDevices()).toEqual([]);

    localStorage.setItem('pairux-devices', '[{"nope":true}]');
    expect(loadDevices()).toEqual([]);
  });
});

describe('daemon requests', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts a session and returns the join details', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionId: 's1', joinCode: 'ABC123', url: 'u' }),
    });

    await expect(startDeviceSession('https://bonita.ts.net')).resolves.toMatchObject({
      joinCode: 'ABC123',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bonita.ts.net/session/start',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('turns a rejection into an actionable message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(getDeviceStatus('https://bonita.ts.net')).rejects.toThrow(/tailnet/i);
  });
});
