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

// jsdom implements neither Web Audio nor MediaStream, but the renderer uses
// both to put a gain stage in front of remote playback. Provide them here so
// components exercise the real code path instead of the production code having
// to carry a "browser might not have this" branch.
//
// Assigned straight onto globalThis rather than via vi.stubGlobal: the teardown
// below calls vi.unstubAllGlobals(), which would otherwise strip these after
// the first test in a file.
class FakeAudioParam {
  value = 0;
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

/** Records when each note was scheduled so tests can assert the figure. */
class FakeOscillator {
  type = 'sine';
  frequency = new FakeAudioParam();
  startTime = 0;
  connect(): void {
    // Graph shape is asserted with a purpose-built mock where it matters.
  }
  disconnect(): void {
    // As above.
  }
  start(when = 0): void {
    this.startTime = when;
  }
  stop(): void {
    // Nothing to tear down.
  }
}

class FakeAudioNode {
  connect(): void {
    // Graph shape is asserted in remoteAudioGain.test.ts with its own mock.
  }
  disconnect(): void {
    // As above.
  }
}

class FakeMediaStream {
  private tracks: unknown[];
  private readonly listeners = new Map<string, Set<(event: { track: unknown }) => void>>();
  id = 'fake-stream';
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): unknown[] {
    return this.tracks;
  }
  getAudioTracks(): unknown[] {
    return this.tracks.filter((track) => (track as { kind?: string }).kind === 'audio');
  }
  getVideoTracks(): unknown[] {
    return this.tracks.filter((track) => (track as { kind?: string }).kind === 'video');
  }
  addTrack(track: unknown): void {
    this.tracks.push(track);
  }
  removeTrack(track: unknown): void {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
    this.listeners.get('removetrack')?.forEach((listener) => listener({ track }));
  }
  addEventListener(type: string, listener: (event: { track: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: { track: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeAudioNode();
  readonly createdOscillators: FakeOscillator[] = [];
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  createMediaStreamSource(): FakeAudioNode {
    return new FakeAudioNode();
  }
  createGain(): FakeAudioNode & { gain: FakeAudioParam } {
    return Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() });
  }
  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.createdOscillators.push(oscillator);
    return oscillator;
  }
  createDynamicsCompressor(): FakeAudioNode & {
    threshold: FakeAudioParam;
    knee: FakeAudioParam;
    ratio: FakeAudioParam;
    attack: FakeAudioParam;
    release: FakeAudioParam;
  } {
    return Object.assign(new FakeAudioNode(), {
      threshold: new FakeAudioParam(),
      knee: new FakeAudioParam(),
      ratio: new FakeAudioParam(),
      attack: new FakeAudioParam(),
      release: new FakeAudioParam(),
    });
  }
  createMediaStreamDestination(): FakeAudioNode & { stream: FakeMediaStream } {
    return Object.assign(new FakeAudioNode(), {
      stream: new FakeMediaStream([{ id: 'mixed-audio', kind: 'audio', stop: vi.fn() }]),
    });
  }
}

Object.assign(globalThis, {
  AudioContext: FakeAudioContext,
  MediaStream: FakeMediaStream,
});

// jsdom leaves the media element transport unimplemented, and calling it emits
// a jsdomError. Remote playback genuinely does call play()/pause() — a muted
// element is what keeps a peer-connection track being pulled — so give them
// resolved stand-ins rather than letting every playback test log an error.
Object.defineProperties(HTMLMediaElement.prototype, {
  play: {
    configurable: true,
    writable: true,
    value: (): Promise<void> => Promise.resolve(),
  },
  pause: {
    configurable: true,
    writable: true,
    value: (): void => undefined,
  },
});

// jsdom has no ResizeObserver, and anything that measures a laid-out element
// against a changing container needs one. Nothing here lays anything out, so a
// stand-in that records the callback and never fires it is honest: components
// take their initial measurement and the test drives the rest.
class FakeResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** Test seam: run the callback as if the element had been resized. */
  trigger(entries: ResizeObserverEntry[] = []): void {
    this.callback(entries, this);
  }
}

Object.assign(globalThis, { ResizeObserver: FakeResizeObserver });
