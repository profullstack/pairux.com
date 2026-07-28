/**
 * Devices running `pairux daemon`, and how to talk to them.
 *
 * Addresses live in the browser rather than on our servers: a device's tailnet
 * name is only meaningful inside your tailnet, and the daemon authenticates the
 * caller through Tailscale, so there is nothing for us to usefully store or
 * protect on the server side.
 */

const STORAGE_KEY = 'pairux-devices';

export interface Device {
  id: string;
  /** Label shown in the UI. */
  name: string;
  /** https://<device>.<tailnet>.ts.net */
  url: string;
}

export interface DeviceStatus {
  sharing: boolean;
  sessionId: string | null;
  joinCode: string | null;
}

export interface StartedSession {
  sessionId: string;
  joinCode: string;
  url: string;
}

/**
 * Accepts what a person would actually paste.
 *
 * `tailscale status` prints a bare hostname, the daemon logs a full URL, and
 * people paste either with or without a trailing slash.
 */
export function normalizeDeviceUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (!parsed.hostname.includes('.')) return null;

  // Drop any path: the daemon's endpoints hang off the root.
  return `${parsed.protocol}//${parsed.host}`;
}

/** Suggest a label from the tailnet name, e.g. bonita.tailnet-1234.ts.net → bonita. */
export function deviceNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0] ?? url;
  } catch {
    return url;
  }
}

export function loadDevices(): Device[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (d): d is Device =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as Device).id === 'string' &&
        typeof (d as Device).name === 'string' &&
        typeof (d as Device).url === 'string'
    );
  } catch {
    return [];
  }
}

export function saveDevices(devices: Device[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
  } catch {
    // Storage can be full or blocked; the list is a convenience, not state we
    // cannot rebuild.
  }
}

/**
 * Turn a failed request into something a person can act on.
 *
 * The common failure is simply not being on the tailnet, which surfaces as an
 * opaque network error, so it is worth naming explicitly.
 */
export function describeDeviceError(error: unknown, status?: number): string {
  if (status === 401) {
    return 'This device did not recognise you. Make sure this phone is signed in to the same tailnet.';
  }
  if (status === 403) {
    return 'The device refused the request. It only accepts commands from pairux.com.';
  }
  if (status !== undefined && status >= 500) {
    return 'The device could not start a session. Check the screen-sharing prompt on the device itself.';
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'The device did not respond in time.';
  }
  return 'Could not reach the device. Check it is switched on, running `pairux daemon`, and that you are on the same tailnet.';
}

async function request<T>(url: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 15_000);

  try {
    const res = await fetch(`${url}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      const error = new Error(describeDeviceError(null, res.status));
      throw error;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function getDeviceStatus(url: string): Promise<DeviceStatus> {
  return request<DeviceStatus>(url, '/status');
}

export function startDeviceSession(url: string): Promise<StartedSession> {
  return request<StartedSession>(url, '/session/start', { method: 'POST' });
}

export function stopDeviceSession(url: string): Promise<{ stopped: boolean }> {
  return request<{ stopped: boolean }>(url, '/session/stop', { method: 'POST' });
}
