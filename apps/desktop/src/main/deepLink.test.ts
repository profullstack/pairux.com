import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    setAsDefaultProtocolClient: vi.fn().mockReturnValue(true),
  },
  BrowserWindow: vi.fn(),
}));

import { parseDeepLink, findDeepLinkArg, handleDeepLink, setDeepLinkWindow } from './deepLink';

describe('parseDeepLink', () => {
  it('sends a host link to Home with the session to resume', () => {
    expect(parseDeepLink('pairux://host/ff8cf03e-076e-42da-a4f0-a3a17038df03')).toBe(
      '/?shareSessionId=ff8cf03e-076e-42da-a4f0-a3a17038df03'
    );
  });

  it('accepts the slashless form some launchers hand over', () => {
    expect(parseDeepLink('pairux:host/abc123')).toBe('/?shareSessionId=abc123');
  });

  it('treats share as an alias of host', () => {
    expect(parseDeepLink('pairux://share/abc123')).toBe('/?shareSessionId=abc123');
  });

  it('ignores surrounding whitespace and scheme casing', () => {
    expect(parseDeepLink('  PAIRUX://HOST/abc123\n')).toBe('/?shareSessionId=abc123');
  });

  it('normalises a join code and routes it to the join page', () => {
    expect(parseDeepLink('pairux://join/ab-c12x')).toBe('/join?code=ABC12X');
  });

  it('rejects a join code that is not six characters', () => {
    expect(parseDeepLink('pairux://join/ABC')).toBeNull();
  });

  it('routes a viewer link to the viewer route', () => {
    expect(parseDeepLink('pairux://view/session-1')).toBe('/viewer/session-1');
    expect(parseDeepLink('pairux://viewer/session-1')).toBe('/viewer/session-1');
  });

  it('rejects an unknown action', () => {
    expect(parseDeepLink('pairux://settings/anything')).toBeNull();
  });

  it('rejects a link with no target', () => {
    expect(parseDeepLink('pairux://host')).toBeNull();
    expect(parseDeepLink('pairux://')).toBeNull();
  });

  it('rejects another scheme', () => {
    expect(parseDeepLink('https://pairux.com/host/abc123')).toBeNull();
  });

  it('refuses a session id that could escape the route', () => {
    expect(parseDeepLink('pairux://host/..%2F..%2Flogin')).toBeNull();
    expect(parseDeepLink('pairux://viewer/a b')).toBeNull();
  });
});

describe('findDeepLinkArg', () => {
  it('finds the link among the other launch arguments', () => {
    expect(findDeepLinkArg(['/opt/pairux/pairux', '--no-sandbox', 'pairux://host/abc123'])).toBe(
      'pairux://host/abc123'
    );
  });

  it('returns null when the app was launched without one', () => {
    expect(findDeepLinkArg(['/opt/pairux/pairux', '--no-sandbox'])).toBeNull();
  });
});

interface FakeWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: {
    isLoading: () => boolean;
    send: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  };
}

function fakeWindow(options: { loading?: boolean } = {}): FakeWindow {
  let loading = options.loading ?? false;
  const finishHandlers: (() => void)[] = [];
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isLoading: () => loading,
      send: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'did-finish-load') finishHandlers.push(handler);
      }),
    },
    // Test helper: pretend the renderer finished loading.
    finishLoad(): void {
      loading = false;
      finishHandlers.splice(0).forEach((handler) => {
        handler();
      });
    },
  } as FakeWindow & { finishLoad: () => void };
}

describe('deep link delivery', () => {
  beforeEach(() => {
    setDeepLinkWindow(null);
  });

  it('navigates and focuses a window that is already up', () => {
    const window = fakeWindow();
    setDeepLinkWindow(window as never);

    handleDeepLink('pairux://host/abc123');

    expect(window.webContents.send).toHaveBeenCalledWith('navigate', '/?shareSessionId=abc123');
    expect(window.focus).toHaveBeenCalled();
  });

  it('holds a link that arrives before the renderer and flushes it on load', () => {
    // The cold-start case: the OS opens the app and the link at the same time.
    handleDeepLink('pairux://host/abc123');

    const window = fakeWindow({ loading: true });
    setDeepLinkWindow(window as never);
    expect(window.webContents.send).not.toHaveBeenCalled();

    (window as unknown as { finishLoad: () => void }).finishLoad();
    expect(window.webContents.send).toHaveBeenCalledWith('navigate', '/?shareSessionId=abc123');
  });

  it('does not replay a flushed link at the next window', () => {
    handleDeepLink('pairux://host/abc123');

    const first = fakeWindow();
    setDeepLinkWindow(first as never);
    expect(first.webContents.send).toHaveBeenCalledTimes(1);

    setDeepLinkWindow(null);
    const second = fakeWindow();
    setDeepLinkWindow(second as never);
    expect(second.webContents.send).not.toHaveBeenCalled();
  });

  it('drops a link it does not recognise instead of navigating', () => {
    const window = fakeWindow();
    setDeepLinkWindow(window as never);

    handleDeepLink('pairux://nope');

    expect(window.webContents.send).not.toHaveBeenCalled();
  });
});
