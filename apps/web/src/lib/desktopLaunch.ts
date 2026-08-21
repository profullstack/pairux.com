/**
 * Hand a session to the PairUX desktop app, and fall back to this browser.
 *
 * Hosting in a browser tab cannot inject input, so a session started from the
 * web player is watch-only — the whole point of PairUX is the other half. So
 * starting a session tries `pairux://` first and only plays here if nothing
 * answers.
 *
 * There is no way to ask a browser whether a scheme is registered. The reliable
 * signal is the opposite one: if the app opens, this page loses focus. So we
 * fire the link, watch for the page going away, and treat "still here after a
 * moment" as "nothing handled it".
 */

/** Same key the settings page writes; the opt-out lives with the other prefs. */
const SETTINGS_KEY = 'pairux-web-settings';

/** How long to wait for the app to take focus before playing in the browser. */
export const DESKTOP_LAUNCH_TIMEOUT_MS = 2000;

export type DeepLinkKind = 'host' | 'join' | 'view';

/** Build the `pairux://` URL the desktop app answers. */
export function buildDesktopLink(kind: DeepLinkKind, value: string): string {
  return `pairux://${kind}/${encodeURIComponent(value)}`;
}

/**
 * Whether this browser could plausibly have the desktop app behind it.
 *
 * There is no PairUX build for phones or tablets, and an unhandled scheme is
 * noisier there — iOS Safari puts up an error dialog — so mobile goes straight
 * to the web player.
 */
export function canLaunchDesktopApp(userAgent: string = navigator.userAgent): boolean {
  return !/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(userAgent);
}

/** The user's "open sessions in the desktop app" preference; defaults to on. */
export function prefersDesktopApp(storage: Storage | undefined = safeStorage()): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { session?: { openInDesktopApp?: boolean } };
    return parsed.session?.openInDesktopApp !== false;
  } catch {
    return true;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Storage can throw outright when cookies are blocked.
    return undefined;
  }
}

/** Should a session start by trying the desktop app at all? */
export function shouldTryDesktopApp(): boolean {
  return typeof window !== 'undefined' && canLaunchDesktopApp() && prefersDesktopApp();
}

export interface LaunchDesktopOptions {
  /** Runs when nothing handled the link, i.e. play it in the browser instead. */
  onFallback: () => void;
  /** Runs when the app appears to have taken over. */
  onLaunched?: () => void;
  timeoutMs?: number;
  /** Injectable for tests. */
  win?: Window;
  doc?: Document;
}

/**
 * Fire a deep link and resolve one way or the other.
 *
 * Returns a cancel function — call it when the user opts out by hand (or the
 * component unmounts) so the fallback does not fire underneath them.
 */
export function launchDesktopApp(deepLink: string, options: LaunchDesktopOptions): () => void {
  const {
    onFallback,
    onLaunched,
    timeoutMs = DESKTOP_LAUNCH_TIMEOUT_MS,
    win = window,
    doc = document,
  } = options;

  let settled = false;

  const cleanup = (): void => {
    // Defined below, but nothing can settle before the timer exists: the only
    // callers are event listeners and the timer itself.
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win.removeEventListener('blur', onLeft);
    win.removeEventListener('pagehide', onLeft);
  };

  const settle = (outcome: 'launched' | 'fallback' | 'cancelled'): void => {
    if (settled) return;
    settled = true;
    cleanup();
    if (outcome === 'fallback') onFallback();
    if (outcome === 'launched') onLaunched?.();
  };

  function onLeft(): void {
    // Focus went elsewhere: the app took it.
    settle('launched');
  }

  function onVisibilityChange(): void {
    if (doc.hidden) settle('launched');
  }

  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('blur', onLeft);
  win.addEventListener('pagehide', onLeft);

  const timer = setTimeout(() => {
    settle('fallback');
  }, timeoutMs);

  try {
    win.location.href = deepLink;
  } catch {
    // Some browsers throw on an unregistered scheme rather than doing nothing.
    settle('fallback');
  }

  return () => {
    settle('cancelled');
  };
}
