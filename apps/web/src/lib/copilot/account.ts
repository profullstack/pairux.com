/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import {
  isCopilotMode,
  isCopilotRole,
  type CopilotMode,
  type CopilotRole,
} from '@pairux/meeting-copilot/types';
import { serviceClient } from '@/lib/supabase/service';
import { resolveUserPlan, type Db } from '@/lib/orgs';
import { PLANS, upgradePath } from '@/lib/plans';
import { isSealedValue, openWithPrivateKey, sealToPublicKey } from '@/lib/sealed/crypto';
import {
  COPILOT_SEAL_VERSION,
  copilotPrivateKey,
  isLegacyValue,
  keyField,
  loadSealWith,
} from './keys';

/** Plans that include the copilot (own plan or an org's). */
const COPILOT_PLANS = new Set(['pro', 'team']);

export const COPILOT_REQUIRES_PRO = `The AI copilot is part of PairUX Pro ($${String(PLANS.pro.priceUsd)}/month). Upgrade at https://pairux.com${upgradePath('pro')}.`;

export const KEY_PROVIDERS = ['anthropic', 'openai', 'elevenlabs'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
export const isKeyProvider = (value: unknown): value is KeyProvider =>
  typeof value === 'string' && (KEY_PROVIDERS as readonly string[]).includes(value);

/** The owner's own keys, opened for one meeting while it is unlocked. */
export type CopilotKeys = Partial<Record<KeyProvider, string>>;

/**
 * Where the owner's own keys stand for one meeting:
 *   none      no own keys saved
 *   unlocked  sealed keys, unlocked for this meeting (opened in `keys`)
 *   locked    sealed keys, not unlocked: free models only until they unlock
 *   legacy    keys still under the old server key: set a key passphrase to move them
 */
export type OwnKeysState = 'none' | 'unlocked' | 'locked' | 'legacy';

export interface CopilotSettings {
  mode: CopilotMode;
  role: CopilotRole;
  keys: CopilotKeys;
  keysState: OwnKeysState;
}
/** What the API returns: never key material, only whether a key is set and its last 4. */
export interface PublicCopilotSettings {
  mode: CopilotMode;
  role: CopilotRole;
  keys: Record<KeyProvider, { set: boolean; last4: string | null }>;
  /** Has the owner set a key passphrase (needed to save or use own keys)? */
  passphraseSet: boolean;
  /** Keys still under the old server key, waiting for the owner's passphrase. */
  legacyKeys: number;
}

// --- BYOK: sealed to the owner (lib/copilot/keys.ts); no server key opens them ---

/** Own keys need no server secret any more: they are sealed to the owner's key passphrase. */
export const byokAvailable = (): boolean => true;

/** Saving a key before the owner has set a key passphrase. */
export class KeyPassphraseRequiredError extends Error {
  constructor() {
    super('Set a key passphrase first: your keys are sealed under it and PairUX cannot open them.');
  }
}

/** A plausible key for each provider: rejects pasted junk before it is stored. */
export function validKeyShape(provider: KeyProvider, key: string): boolean {
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) return false;
  if (provider === 'anthropic') return key.startsWith('sk-ant-');
  if (provider === 'openai') return key.startsWith('sk-');
  return /^[A-Za-z0-9_-]+$/.test(key);
}

// --- Account: eligibility, settings, wallet ---

export class CopilotAccounts {
  private readonly admins = new Map<string, { admin: boolean; until: number }>();
  private readonly plans = new Map<string, { pro: boolean; until: number }>();
  private readonly settings = new Map<string, { value: CopilotSettings; until: number }>();
  constructor(private readonly db: any = serviceClient()) {}

  async isAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const cached = this.admins.get(userId);
    if (cached && cached.until > Date.now()) return cached.admin;
    const { data } = await this.db
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    const admin = Boolean(data);
    this.admins.set(userId, { admin, until: Date.now() + 300_000 });
    return admin;
  }

  /** Pro or Team (own or org plan), or a PairUX admin. */
  async eligible(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    if (await this.isAdmin(userId)) return true;
    const cached = this.plans.get(userId);
    if (cached && cached.until > Date.now()) return cached.pro;
    let pro = false;
    try {
      pro = COPILOT_PLANS.has(await resolveUserPlan(this.db as Db, userId));
    } catch (error) {
      console.error('[copilot] plan lookup failed:', error);
    }
    this.plans.set(userId, { pro, until: Date.now() + 60_000 });
    return pro;
  }

  /**
   * Mode, role and, for a meeting the owner unlocked, their opened own keys.
   * Without `sessionId` (or while locked) no key is opened.
   */
  async settingsFor(userId: string, sessionId = ''): Promise<CopilotSettings> {
    const cacheKey = `${userId}:${sessionId}`;
    const cached = this.settings.get(cacheKey);
    if (cached && cached.until > Date.now()) return cached.value;
    const { data } = await this.db
      .from('copilot_settings')
      .select('mode, role, anthropic_key, openai_key, elevenlabs_key')
      .eq('user_id', userId)
      .maybeSingle();
    const privateKey = copilotPrivateKey(userId, sessionId);
    const keys: CopilotKeys = {};
    let sealed = 0;
    let legacy = 0;
    for (const provider of KEY_PROVIDERS) {
      const stored: unknown = data?.[`${provider}_key`];
      if (isLegacyValue(stored)) legacy++;
      if (!isSealedValue(stored)) continue;
      sealed++;
      if (!privateKey) continue;
      try {
        keys[provider] = await openWithPrivateKey(privateKey, stored, userId, keyField(provider));
      } catch {
        console.error(`[copilot] stored ${provider} key could not be opened`);
      }
    }
    const keysState: OwnKeysState = Object.keys(keys).length
      ? 'unlocked'
      : sealed
        ? 'locked'
        : legacy
          ? 'legacy'
          : 'none';
    const value: CopilotSettings = {
      mode: isCopilotMode(data?.mode) ? data.mode : 'auto',
      role: isCopilotRole(data?.role) ? data.role : 'general',
      keys,
      keysState,
    };
    this.settings.set(cacheKey, { value, until: Date.now() + 30_000 });
    return value;
  }

  /** Drop cached settings (and any opened keys in them) for an owner. */
  forget(userId: string): void {
    for (const key of [...this.settings.keys()])
      if (key.startsWith(`${userId}:`)) this.settings.delete(key);
  }

  async publicSettings(userId: string): Promise<PublicCopilotSettings> {
    const { data } = await this.db
      .from('copilot_settings')
      .select(
        'mode, role, anthropic_key, anthropic_last4, openai_key, openai_last4, elevenlabs_key, elevenlabs_last4'
      )
      .eq('user_id', userId)
      .maybeSingle();
    const keys = {} as PublicCopilotSettings['keys'];
    let legacyKeys = 0;
    for (const provider of KEY_PROVIDERS) {
      keys[provider] = {
        set: Boolean(data?.[`${provider}_key`]),
        last4: data?.[`${provider}_last4`] ?? null,
      };
      if (isLegacyValue(data?.[`${provider}_key`])) legacyKeys++;
    }
    return {
      mode: isCopilotMode(data?.mode) ? data.mode : 'auto',
      role: isCopilotRole(data?.role) ? data.role : 'general',
      keys,
      passphraseSet: Boolean(await loadSealWith(this.db, userId)),
      legacyKeys,
    };
  }

  /** Save mode/role and set (string) or delete (null) keys; undefined leaves a key alone. */
  async saveSettings(
    userId: string,
    patch: {
      mode?: CopilotMode;
      role?: CopilotRole;
      keys?: Partial<Record<KeyProvider, string | null>>;
    }
  ): Promise<PublicCopilotSettings> {
    const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    if (patch.mode) row.mode = patch.mode;
    if (patch.role) row.role = patch.role;
    const adding = KEY_PROVIDERS.some((provider) => Boolean(patch.keys?.[provider]));
    // A new key is sealed to the owner's public key right here; we keep no way to open it.
    const seal = adding ? await loadSealWith(this.db, userId) : null;
    if (adding && !seal) throw new KeyPassphraseRequiredError();
    for (const provider of KEY_PROVIDERS) {
      const value = patch.keys?.[provider];
      if (value === undefined) continue;
      if (value === null || value === '') {
        row[`${provider}_key`] = null;
        row[`${provider}_last4`] = null;
      } else if (seal) {
        row[`${provider}_key`] = await sealToPublicKey(
          seal.public_key,
          value,
          userId,
          keyField(provider)
        );
        row[`${provider}_last4`] = value.slice(-4);
        row.seal_version = COPILOT_SEAL_VERSION;
      }
    }
    const { error } = await this.db.from('copilot_settings').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(`Saving copilot settings failed: ${String(error.message)}`);
    this.forget(userId);
    return this.publicSettings(userId);
  }

  async balanceMicros(userId: string): Promise<number> {
    const { data } = await this.db
      .from('copilot_wallets')
      .select('balance_micros')
      .eq('user_id', userId)
      .maybeSingle();
    return Number(data?.balance_micros ?? 0);
  }

  /** Take a PAYG charge. Returns the ledger id, or null when the wallet is empty. */
  async charge(input: {
    userId: string;
    sessionId: string;
    provider: string;
    kind: 'transcription' | 'llm';
    units: number;
    costMicros: number;
    chargeMicros: number;
  }): Promise<string | null> {
    const { data, error } = await this.db.rpc('copilot_charge', {
      p_user: input.userId,
      p_session: input.sessionId,
      p_provider: input.provider,
      p_kind: input.kind,
      p_units: Math.max(0, Math.round(input.units)),
      p_cost: Math.max(0, Math.round(input.costMicros)),
      p_charge: Math.max(0, Math.round(input.chargeMicros)),
    });
    if (error) {
      console.error('[copilot] copilot_charge failed:', error);
      throw new Error('Copilot billing is unavailable.');
    }
    return (data as string | null) ?? null;
  }

  async refund(id: string): Promise<void> {
    const { error } = await this.db.rpc('copilot_refund', { p_id: id });
    if (error) console.error('[copilot] copilot_refund failed:', error);
  }

  async usage(userId: string, limit = 50) {
    const { data } = await this.db
      .from('copilot_usage')
      .select('session_id, provider, kind, units, charge_micros, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as {
      session_id: string;
      provider: string;
      kind: string;
      units: number;
      charge_micros: number;
      status: string;
      created_at: string;
    }[];
  }
}
