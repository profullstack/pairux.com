/**
 * The desktop app's AI call analysis choice, set on the home screen before a
 * call and applied to every way of starting one (Start a Meeting, Create
 * Link, Start Voice Session, picking a screen). Remembered between launches;
 * a session keeps the value it was created with.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CallAnalysisSettings } from '@pairux/shared-types';

const KEY = 'pairux-call-analysis';
const EVENT = 'pairux-call-analysis-change';

export const DEFAULT_ANALYSIS: CallAnalysisSettings = {
  enabled: false,
  kind: 'general',
  keepRecording: true,
};

export function readAnalysisPreference(): CallAnalysisSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_ANALYSIS;
    const parsed = JSON.parse(raw) as Partial<CallAnalysisSettings>;
    return {
      enabled: parsed.enabled === true,
      kind: parsed.kind ?? 'general',
      keepRecording: parsed.keepRecording !== false,
    };
  } catch {
    return DEFAULT_ANALYSIS;
  }
}

export function writeAnalysisPreference(next: CallAnalysisSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the choice still applies for this window
  }
  window.dispatchEvent(new Event(EVENT));
}

const WORKSPACE_KEY = 'pairux-call-workspace';

export interface CallWorkspace {
  orgId?: string;
  teamId?: string;
}

export function readWorkspace(): CallWorkspace {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? '{}') as CallWorkspace;
    return {
      ...(parsed.orgId ? { orgId: parsed.orgId } : {}),
      ...(parsed.teamId ? { teamId: parsed.teamId } : {}),
    };
  } catch {
    return {};
  }
}

export function writeWorkspace(next: CallWorkspace): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable
  }
}

/** What to send when creating a session: the choice when it is on, else nothing. */
export function analysisForNewCall(): CallAnalysisSettings | undefined {
  const pref = readAnalysisPreference();
  return pref.enabled ? pref : undefined;
}

export function useAnalysisPreference(): [
  CallAnalysisSettings,
  (next: CallAnalysisSettings) => void,
] {
  const [value, setValue] = useState(readAnalysisPreference);
  useEffect(() => {
    const sync = () => {
      setValue(readAnalysisPreference());
    };
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  const set = useCallback((next: CallAnalysisSettings) => {
    writeAnalysisPreference(next);
    setValue(next);
  }, []);
  return [value, set];
}
