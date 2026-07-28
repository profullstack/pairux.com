import { describe, it, expect, beforeEach } from 'vitest';
import { isForceRelayEnabled, isPreferTailnetEnabled, buildSfuRtcConfig } from './iceConfig';

const SETTINGS_KEY = 'pairux-settings';

// This environment exposes `localStorage` as a bare object with no Storage
// methods, so install a minimal in-memory shim the module under test can use.
function installStorage(getItem?: (key: string) => string | null): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: getItem ?? ((key: string) => store.get(key) ?? null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

function setSettings(value: unknown): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}

describe('iceConfig settings readers', () => {
  beforeEach(() => {
    installStorage();
  });

  it('both default to off when nothing is persisted', () => {
    expect(isForceRelayEnabled()).toBe(false);
    expect(isPreferTailnetEnabled()).toBe(false);
  });

  it('reads each flag independently', () => {
    setSettings({ streaming: { forceRelay: true, preferTailnet: false } });
    expect(isForceRelayEnabled()).toBe(true);
    expect(isPreferTailnetEnabled()).toBe(false);

    setSettings({ streaming: { forceRelay: false, preferTailnet: true } });
    expect(isForceRelayEnabled()).toBe(false);
    expect(isPreferTailnetEnabled()).toBe(true);
  });

  // Settings written before preferTailnet existed have no such key. Reading one
  // must not be mistaken for opting in — this relaxes a network policy.
  it('treats a missing key on older settings as off', () => {
    setSettings({ streaming: { forceRelay: true } });
    expect(isPreferTailnetEnabled()).toBe(false);
  });

  it('only accepts a literal true, not a truthy value', () => {
    setSettings({ streaming: { preferTailnet: 'yes' } });
    expect(isPreferTailnetEnabled()).toBe(false);
  });

  it('falls back to off on unparseable settings', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(isPreferTailnetEnabled()).toBe(false);
    expect(isForceRelayEnabled()).toBe(false);
  });

  it('falls back to off when storage itself throws', () => {
    installStorage(() => {
      throw new Error('blocked');
    });
    expect(isPreferTailnetEnabled()).toBe(false);
    expect(isForceRelayEnabled()).toBe(false);
  });

  // preferTailnet is a P2P-only concern; it must not leak into the SFU config,
  // where relaying through the server is the whole point.
  it('leaves the SFU config untouched by preferTailnet', () => {
    setSettings({ streaming: { preferTailnet: true } });
    expect(buildSfuRtcConfig()).toEqual({});
  });

  it('still applies force relay to the SFU config', () => {
    setSettings({ streaming: { forceRelay: true, preferTailnet: true } });
    expect(buildSfuRtcConfig([{ urls: 'stun:example:3478' }])).toEqual({
      iceServers: [{ urls: 'stun:example:3478' }],
      iceTransportPolicy: 'relay',
    });
  });
});
