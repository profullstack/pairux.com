import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';

// Make React available globally for JSX
globalThis.React = React;

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
