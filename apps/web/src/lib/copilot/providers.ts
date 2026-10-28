import type { CopilotMode } from '@pairux/meeting-copilot/types';
import type { CopilotKeys } from './account';

/**
 * Free self-hosted models first; paid cloud providers as the fallback or, by
 * the owner's choice, the override (plans/MEETING-COPILOT.md §4).
 *
 *   local:     our self-hosted open-source model (free)
 *   own:       the owner's own key (BYOK, never charged by us)
 *   ours:      our cloud key, pay as you go at cost + 10% (free for admins)
 */
export type ProviderStep =
  | { kind: 'local' }
  | { kind: 'own'; provider: 'anthropic' | 'openai' | 'elevenlabs' }
  | { kind: 'ours'; provider: 'anthropic' | 'elevenlabs' };

export interface ProviderContext {
  userId: string;
  sessionId: string;
  mode: CopilotMode;
  keys: CopilotKeys;
  /**
   * The owner has own keys saved but they are not unlocked for this meeting:
   * free models only, never our paid provider in their place.
   */
  keysLocked?: boolean;
  admin: boolean;
}

/** The order to try providers in for one capability. */
export function providerChain(
  mode: CopilotMode,
  options: {
    /** Is the free self-hosted model configured? */
    local: boolean;
    /** The owner's own keys usable for this capability, in preference order. */
    own: ('anthropic' | 'openai' | 'elevenlabs')[];
    /** Our paid provider for this capability, when its key is configured. */
    ours: 'anthropic' | 'elevenlabs' | null;
  }
): ProviderStep[] {
  const local: ProviderStep[] = options.local ? [{ kind: 'local' }] : [];
  const own: ProviderStep[] = options.own.map((provider) => ({ kind: 'own', provider }));
  const ours: ProviderStep[] = options.ours ? [{ kind: 'ours', provider: options.ours }] : [];
  switch (mode) {
    case 'free':
      return local;
    case 'byok':
      return [...own, ...local];
    case 'cloud':
      return [...own, ...ours, ...local];
    case 'auto':
      return [...local, ...own, ...ours];
  }
}

/** How a provider is named to the owner. */
export function stepLabel(step: ProviderStep, detail: string): string {
  if (step.kind === 'local') return `${detail} (free, self-hosted)`;
  if (step.kind === 'own') return `${detail} (your key)`;
  return `${detail} (pay as you go)`;
}

/**
 * A provider that failed is skipped for a while, so a dead local model does not
 * add its timeout to every phrase. Keyed per provider (and per owner for keys).
 */
export class Cooldowns {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  down(key: string): boolean {
    const until = this.until.get(key);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.until.delete(key);
      return false;
    }
    return true;
  }
  fail(key: string, ms = 60_000): void {
    this.until.set(key, this.now() + ms);
  }
  ok(key: string): void {
    this.until.delete(key);
  }
}

/** Configured base URL of an OpenAI-compatible endpoint, or null when turned off. */
export function endpoint(value: string | undefined, fallback: string): string | null {
  const url = (value ?? fallback).trim();
  if (!url || url === 'off') return null;
  return url.replace(/\/+$/, '');
}
