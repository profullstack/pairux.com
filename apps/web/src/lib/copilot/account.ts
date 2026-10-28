/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  isCopilotMode,
  isCopilotRole,
  type CopilotMode,
  type CopilotRole,
} from '@pairux/meeting-copilot/types';
import { serviceClient } from '@/lib/supabase/service';
import { resolveUserPlan, type Db } from '@/lib/orgs';
import { PLANS, upgradePath } from '@/lib/plans';

/** Plans that include the copilot (own plan or an org's). */
const COPILOT_PLANS = new Set(['pro', 'team']);

export const COPILOT_REQUIRES_PRO = `The AI copilot is part of PairUX Pro ($${String(PLANS.pro.priceUsd)}/month). Upgrade at https://pairux.com${upgradePath('pro')}.`;

export const KEY_PROVIDERS = ['anthropic', 'openai', 'elevenlabs'] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
export const isKeyProvider = (value: unknown): value is KeyProvider =>
  typeof value === 'string' && (KEY_PROVIDERS as readonly string[]).includes(value);

/** The owner's own keys, decrypted, for this process only. */
export type CopilotKeys = Partial<Record<KeyProvider, string>>;

export interface CopilotSettings {
  mode: CopilotMode;
  role: CopilotRole;
  keys: CopilotKeys;
}
/** What the API returns: never key material, only whether a key is set and its last 4. */
export interface PublicCopilotSettings {
  mode: CopilotMode;
  role: CopilotRole;
  keys: Record<KeyProvider, { set: boolean; last4: string | null }>;
}

// --- BYOK encryption (AES-256-GCM, key derived from COPILOT_KEYS_SECRET) ---

function secretKey(): Buffer {
  const secret = process.env.COPILOT_KEYS_SECRET ?? '';
  if (secret.length < 32)
    throw new Error('COPILOT_KEYS_SECRET is not set (32+ characters); own keys are disabled.');
  return createHash('sha256').update(`pairux-copilot-keys:${secret}`).digest();
}
export const byokAvailable = (): boolean => (process.env.COPILOT_KEYS_SECRET ?? '').length >= 32;

/** The full 128-bit GCM tag; a shorter one is refused (truncated tags enable forgeries). */
const TAG_BYTES = 16;

/** v1.<iv>.<tag>.<ciphertext>, base64url. */
export function sealKey(plain: string, key: Buffer = secretKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}
export function openKey(sealed: string, key: Buffer = secretKey()): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable stored key.');
  const authTag = Buffer.from(tag, 'base64url');
  if (authTag.length !== TAG_BYTES) throw new Error('Unreadable stored key.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
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

  async settingsFor(userId: string): Promise<CopilotSettings> {
    const cached = this.settings.get(userId);
    if (cached && cached.until > Date.now()) return cached.value;
    const { data } = await this.db
      .from('copilot_settings')
      .select('mode, role, anthropic_key, openai_key, elevenlabs_key')
      .eq('user_id', userId)
      .maybeSingle();
    const keys: CopilotKeys = {};
    for (const provider of KEY_PROVIDERS) {
      const sealed = data?.[`${provider}_key`];
      if (typeof sealed === 'string' && sealed && byokAvailable()) {
        try {
          keys[provider] = openKey(sealed);
        } catch (error) {
          console.error(`[copilot] stored ${provider} key could not be opened:`, error);
        }
      }
    }
    const value: CopilotSettings = {
      mode: isCopilotMode(data?.mode) ? data.mode : 'auto',
      role: isCopilotRole(data?.role) ? data.role : 'general',
      keys,
    };
    this.settings.set(userId, { value, until: Date.now() + 30_000 });
    return value;
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
    for (const provider of KEY_PROVIDERS)
      keys[provider] = {
        set: Boolean(data?.[`${provider}_key`]),
        last4: data?.[`${provider}_last4`] ?? null,
      };
    return {
      mode: isCopilotMode(data?.mode) ? data.mode : 'auto',
      role: isCopilotRole(data?.role) ? data.role : 'general',
      keys,
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
    for (const provider of KEY_PROVIDERS) {
      const value = patch.keys?.[provider];
      if (value === undefined) continue;
      if (value === null || value === '') {
        row[`${provider}_key`] = null;
        row[`${provider}_last4`] = null;
      } else {
        row[`${provider}_key`] = sealKey(value);
        row[`${provider}_last4`] = value.slice(-4);
      }
    }
    const { error } = await this.db.from('copilot_settings').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(`Saving copilot settings failed: ${String(error.message)}`);
    this.settings.delete(userId);
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
