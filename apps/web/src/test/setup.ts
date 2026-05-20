import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';

// Make React available globally for JSX
globalThis.React = React;

// Node v22+ exposes a partial built-in `localStorage`/`sessionStorage` global
// that throws on `getItem`/`clear` without `--localstorage-file=<path>`. That
// stub is non-configurable on globalThis and shadows jsdom's Storage, so install
// a Map-backed Storage implementation that mirrors the Web Storage API.
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: (globalThis as unknown as Record<string, Storage>)[name],
      writable: true,
      configurable: true,
    });
  }
}

// Ensure console is available and stubbed
const originalConsole = { ...console };
beforeEach(() => {
  // Stub console methods to prevent noise in tests
  vi.stubGlobal('console', {
    ...originalConsole,
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  });
  global.fetch = vi.fn();
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
  }),
  usePathname: () => '/test',
}));

// Create a mock Headers-like object
const createMockHeaders = () => {
  const headersMap = new Map<string, string>([['origin', 'http://localhost:3000']]);
  return {
    get: (name: string) => headersMap.get(name.toLowerCase()) ?? null,
    has: (name: string) => headersMap.has(name.toLowerCase()),
    entries: () => headersMap.entries(),
    keys: () => headersMap.keys(),
    values: () => headersMap.values(),
    forEach: (cb: (value: string, key: string) => void) => headersMap.forEach(cb),
  };
};

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      delete: vi.fn(),
    })
  ),
  headers: vi.fn(() => Promise.resolve(createMockHeaders())),
}));
