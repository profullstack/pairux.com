import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDesktopLink,
  canLaunchDesktopApp,
  launchDesktopApp,
  prefersDesktopApp,
} from './desktopLaunch';

describe('buildDesktopLink', () => {
  it('builds the host link the desktop app answers', () => {
    expect(buildDesktopLink('host', 'ff8cf03e-076e-42da-a4f0-a3a17038df03')).toBe(
      'pairux://host/ff8cf03e-076e-42da-a4f0-a3a17038df03'
    );
  });

  it('escapes anything odd in the id', () => {
    expect(buildDesktopLink('join', 'a b')).toBe('pairux://join/a%20b');
  });
});

describe('canLaunchDesktopApp', () => {
  it('is true for a desktop browser', () => {
    expect(
      canLaunchDesktopApp(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36'
      )
    ).toBe(true);
  });

  it('is false on phones and tablets, which have no desktop build', () => {
    expect(canLaunchDesktopApp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(
      false
    );
    expect(canLaunchDesktopApp('Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36')).toBe(false);
  });
});

function storageWith(value: string | null): Storage {
  return { getItem: () => value } as unknown as Storage;
}

describe('prefersDesktopApp', () => {
  it('defaults to on when nothing is stored', () => {
    expect(prefersDesktopApp(storageWith(null))).toBe(true);
  });

  it('defaults to on when the setting has never been touched', () => {
    expect(prefersDesktopApp(storageWith(JSON.stringify({ session: {} })))).toBe(true);
  });

  it('is off once the user turns it off', () => {
    expect(
      prefersDesktopApp(storageWith(JSON.stringify({ session: { openInDesktopApp: false } })))
    ).toBe(false);
  });

  it('survives corrupt settings', () => {
    expect(prefersDesktopApp(storageWith('not json'))).toBe(true);
  });
});

interface FakeWin {
  location: { href: string };
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  fire: (type: string) => void;
}

function fakeWin(): FakeWin {
  const handlers = new Map<string, Set<() => void>>();
  return {
    location: { href: '' },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)?.add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    fire(type) {
      handlers.get(type)?.forEach((handler) => {
        handler();
      });
    },
  };
}

function fakeDoc(): FakeWin & { hidden: boolean } {
  return { ...fakeWin(), hidden: false };
}

describe('launchDesktopApp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the deep link', () => {
    const win = fakeWin();
    const doc = fakeDoc();
    launchDesktopApp('pairux://host/abc', {
      onFallback: vi.fn(),
      win: win as unknown as Window,
      doc: doc as unknown as Document,
    });

    expect(win.location.href).toBe('pairux://host/abc');
  });

  it('falls back to the browser when nothing answers', () => {
    const onFallback = vi.fn();
    const win = fakeWin();
    const doc = fakeDoc();
    launchDesktopApp('pairux://host/abc', {
      onFallback,
      timeoutMs: 2000,
      win: win as unknown as Window,
      doc: doc as unknown as Document,
    });

    expect(onFallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('does not fall back once the app takes focus', () => {
    const onFallback = vi.fn();
    const onLaunched = vi.fn();
    const win = fakeWin();
    const doc = fakeDoc();
    launchDesktopApp('pairux://host/abc', {
      onFallback,
      onLaunched,
      timeoutMs: 2000,
      win: win as unknown as Window,
      doc: doc as unknown as Document,
    });

    win.fire('blur');
    vi.advanceTimersByTime(5000);

    expect(onLaunched).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('does not fall back once the page is hidden', () => {
    const onFallback = vi.fn();
    const win = fakeWin();
    const doc = fakeDoc();
    launchDesktopApp('pairux://host/abc', {
      onFallback,
      timeoutMs: 2000,
      win: win as unknown as Window,
      doc: doc as unknown as Document,
    });

    doc.hidden = true;
    doc.fire('visibilitychange');
    vi.advanceTimersByTime(5000);

    expect(onFallback).not.toHaveBeenCalled();
  });

  it('cancelling stops the fallback firing under the user', () => {
    const onFallback = vi.fn();
    const win = fakeWin();
    const doc = fakeDoc();
    const cancel = launchDesktopApp('pairux://host/abc', {
      onFallback,
      timeoutMs: 2000,
      win: win as unknown as Window,
      doc: doc as unknown as Document,
    });

    cancel();
    vi.advanceTimersByTime(5000);

    expect(onFallback).not.toHaveBeenCalled();
  });

  it('falls back immediately when the browser rejects the scheme', () => {
    const onFallback = vi.fn();
    const win = fakeWin();
    Object.defineProperty(win, 'location', {
      get() {
        return {
          set href(_value: string) {
            throw new Error('unknown scheme');
          },
        };
      },
    });
    const doc = fakeDoc();

    launchDesktopApp('pairux://host/abc', {
      onFallback,
      win: win as unknown as Window,
      doc: doc as unknown as Document,
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});
