/**
 * Which modifier this machine uses for keyboard shortcuts.
 *
 * Needed when acting as a viewer, because the host may be on a different OS:
 * "the shortcut key" is Cmd on macOS and Ctrl everywhere else, and only the
 * viewer knows which one the user actually pressed. See `modifiersFromDomEvent`.
 */

export type AccelPlatform = 'darwin' | 'other';

/**
 * Pure so the mapping is testable without a browser.
 *
 * `navigator.platform` is deprecated and `userAgentData` is Chromium-only, so
 * whichever string the caller could get is matched loosely for "mac".
 */
export function accelPlatformFor(platformHint: string | undefined | null): AccelPlatform {
  return platformHint && /mac/i.test(platformHint) ? 'darwin' : 'other';
}

export function getAccelPlatform(): AccelPlatform {
  if (typeof navigator === 'undefined') return 'other';

  const hint =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.userAgent;

  return accelPlatformFor(hint);
}
