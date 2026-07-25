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
  settingsVersion?: number;
  session?: { defaultMode?: string; allowGuestControlByDefault?: boolean };
}

/**
 * Settings written before this version predate guest control being opt-out.
 *
 * Settings are persisted as a whole object, so every user who ever changed any
 * unrelated preference has the old `allowGuestControlByDefault: false` default
 * baked in. Honouring that stale value would keep remote control switched off
 * for existing installs forever, so values written before this version are
 * treated as "never chosen" rather than as a deliberate opt-out.
 */
export const GUEST_CONTROL_OPT_OUT_VERSION = 1;

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
  const settings = readSettings();

  // Pre-versioning settings carry the old opt-in default, not a real choice.
  if ((settings?.settingsVersion ?? 0) < GUEST_CONTROL_OPT_OUT_VERSION) return true;

  return settings?.session?.allowGuestControlByDefault !== false;
}
