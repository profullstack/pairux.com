import { describe, it, expect, beforeEach } from 'vitest';
import { getDefaultAllowGuestControl, getDefaultSessionMode } from './sessionDefaults';

const SETTINGS_KEY = 'pairux-settings';

// This environment exposes `localStorage` as a bare object with no Storage
// methods, so install a minimal in-memory shim the module under test can use.
function installStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
}

function persist(session: Record<string, unknown>): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ session }));
}

describe('getDefaultSessionMode', () => {
  beforeEach(installStorage);

  it('defaults to sfu when nothing is persisted', () => {
    expect(getDefaultSessionMode()).toBe('sfu');
  });

  it('honors a persisted p2p preference', () => {
    persist({ defaultMode: 'p2p' });
    expect(getDefaultSessionMode()).toBe('p2p');
  });

  it('falls back to sfu on malformed settings', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(getDefaultSessionMode()).toBe('sfu');
  });
});

describe('getDefaultAllowGuestControl', () => {
  beforeEach(installStorage);

  // Regression: sessions were created with allowGuestControl hardcoded false,
  // so the viewer never rendered a "Request control" button and the whole
  // remote-control path stayed dark.
  it('defaults to true when nothing is persisted', () => {
    expect(getDefaultAllowGuestControl()).toBe(true);
  });

  it('returns false only when the host explicitly opted out', () => {
    persist({ allowGuestControlByDefault: false });
    expect(getDefaultAllowGuestControl()).toBe(false);
  });

  it('returns true when explicitly enabled', () => {
    persist({ allowGuestControlByDefault: true });
    expect(getDefaultAllowGuestControl()).toBe(true);
  });

  it('falls back to true on malformed settings', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(getDefaultAllowGuestControl()).toBe(true);
  });
});
