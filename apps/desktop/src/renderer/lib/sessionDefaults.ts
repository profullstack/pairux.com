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
  session?: { defaultMode?: string; allowGuestControlByDefault?: boolean };
}

function readSettings(): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSettings;
  } catch {
    return null;
  }
}

export function getDefaultSessionMode(): SessionMode {
  if (readSettings()?.session?.defaultMode === 'p2p') return 'p2p';
  return 'sfu';
}

/**
 * Whether new sessions let guests ask for remote control, from Settings
 * (pairux-settings.session.allowGuestControlByDefault).
 *
 * This is only the outer of two gates: it decides whether the viewer sees a
 * "Request control" button at all. Nothing is injected until the host also
 * approves that participant, so it defaults to on (opt-out) — matching the
 * Settings default. Hosts who never want to be asked can turn it off.
 */
export function getDefaultAllowGuestControl(): boolean {
  return readSettings()?.session?.allowGuestControlByDefault !== false;
}
