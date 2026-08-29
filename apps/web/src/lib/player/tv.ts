/**
 * Is this a television?
 *
 * A recorded live is watched on a sofa at least as often as at a desk, and the
 * two want different things from the same player. A television has no pointer:
 * every control has to be reachable by a D-pad, hit targets have to survive
 * being aimed at from three metres, and controls that fade after three seconds
 * fade while the reader is still travelling towards them.
 *
 * There is no feature to detect here — the difference is the device, not the
 * API surface — so this is a user agent test, which is the kind of thing that
 * ages badly and is therefore kept to one list, in one file, with a test beside
 * it.
 *
 * The pattern list is deliberately the same one genrewatch.com and
 * tipoffwatch.com use in `apps/web/src/client/tv.js`. These players face the
 * same living rooms, and a device that is a television in one and a desktop in
 * the other is a bug waiting in whichever nobody looked at.
 */

/**
 * Ordered most specific first, so a Fire TV is a Fire TV rather than a generic
 * Android that happens to carry the Silk browser.
 */
const TV_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Amazon Fire TV — the model string, which is the only reliable marker: some
  // Fire TV builds report a plain Chrome user agent with no "Silk" in it.
  [/\bAFT[A-Z0-9]+\b/i, 'firetv'],
  // Kindle Fire tablets.
  [/\bKF[A-Z]+\b/, 'silk'],
  // The Silk browser anywhere else.
  [/\bSilk\b/i, 'silk'],
  [/\bAndroid TV\b/i, 'androidtv'],
  [/\bGoogleTV\b/i, 'googletv'],
  [/\bTizen\b/i, 'tizen'],
  [/\bWeb0S\b/i, 'webos'],
  [/\bRoku\b/i, 'roku'],
  [/AppleTV/i, 'appletv'],
  [/\bCrKey\b/i, 'chromecast'],
  [/\bSMART-TV\b/i, 'smarttv'],
  [/\bSmartTV\b/i, 'smarttv'],
];

/** Which television, or null for anything else. */
export function tvBrowserType(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  for (const [pattern, type] of TV_PATTERNS) if (pattern.test(userAgent)) return type;
  return null;
}

export function isTvBrowser(userAgent: string | null | undefined): boolean {
  return tvBrowserType(userAgent) !== null;
}

export interface UiProfile {
  /** How long the controls stay up after the last input, while playing. */
  hideAfterMs: number;
  /** What an arrow press is worth, in seconds. */
  seekStep: number;
  /** Whether to keep focus rings on always — a D-pad reader is always "tabbing". */
  alwaysShowFocus: boolean;
}

/**
 * The two profiles.
 *
 * A television seeks in larger steps because a D-pad press is a deliberate act
 * and 5 seconds of an hour-long recording is not worth the trip; a desktop
 * seeks in smaller ones because the reader has a scrub bar for anything bigger
 * and is usually correcting an overshoot.
 */
export function uiProfile(isTv: boolean): UiProfile {
  return isTv
    ? { hideAfterMs: 6000, seekStep: 10, alwaysShowFocus: true }
    : { hideAfterMs: 2800, seekStep: 5, alwaysShowFocus: false };
}
