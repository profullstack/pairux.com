/**
 * Default session mode, configurable in Settings (pairux-settings.session).
 *
 * Defaults to SFU: routing calls through the server enables server-side RTMP
 * restreaming ("Go Live (server)") and multi-viewer sessions out of the box.
 * The quick-share flow creates sessions without showing a mode picker, so this
 * default is what most sessions get.
 */

import type { SessionMode } from '@pairux/shared-types';

const SETTINGS_KEY = 'pairux-settings';

interface PersistedSettings {
  session?: { defaultMode?: string };
}

export function getDefaultSessionMode(): SessionMode {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedSettings;
      if (parsed.session?.defaultMode === 'p2p') return 'p2p';
    }
  } catch {
    // fall through to default
  }
  return 'sfu';
}
