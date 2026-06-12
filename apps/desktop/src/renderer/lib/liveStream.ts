/**
 * Shared accessor for the "Live stream to RTMP server(s)" master toggle.
 *
 * The flag lives inside the same `pairux-settings` localStorage blob the
 * Settings page writes (see settings.tsx). It is OFF by default — going live to
 * YouTube/Twitch is opt-in, so a routine call is never streamed by accident.
 */

import { useEffect, useState } from 'react';

const SETTINGS_KEY = 'pairux-settings';

/** Dispatched on `window` whenever the toggle changes within this window. */
export const LIVE_STREAM_CHANGED_EVENT = 'pairux-live-stream-changed';

interface PersistedSettings {
  streaming?: { liveStreamEnabled?: boolean };
}

/** Read the current value synchronously from localStorage. Defaults to false. */
export function isLiveStreamEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as PersistedSettings;
    return parsed.streaming?.liveStreamEnabled === true;
  } catch {
    return false;
  }
}

/**
 * Reactive view of the toggle. Updates when the Settings page changes it (same
 * window via {@link LIVE_STREAM_CHANGED_EVENT}, or another window via `storage`).
 */
export function useLiveStreamEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => isLiveStreamEnabled());

  useEffect(() => {
    const sync = (): void => {
      setEnabled(isLiveStreamEnabled());
    };
    window.addEventListener(LIVE_STREAM_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LIVE_STREAM_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return enabled;
}
