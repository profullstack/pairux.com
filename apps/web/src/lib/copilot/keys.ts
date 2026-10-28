/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * The copilot's own-key (BYOK) sealing, on the seal v2 scheme in lib/sealed
 * (the same key passphrase and seal as the YouTube token).
 *
 * Each stored key is sealed to the owner's PUBLIC key, so saving needs no
 * unlock. Opening needs the owner's private key, which the server holds only
 * while a meeting's copilot runs: the browser derives the data key from the
 * passphrase, sends it with Start, and the opened private key is kept in
 * process memory under `copilot:<user>:<session>` with a TTL. Stopping the
 * copilot, the meeting ending, Lock, or a restart drops it; the copilot then
 * runs on the free models ("locked: unlock to resume") and never charges the
 * wallet in place of the owner's keys.
 *
 * Legacy rows (v1, AES-GCM under the server env key COPILOT_KEYS_SECRET) are
 * never used for provider calls. They are read once, by the logged-in owner's
 * own request, re-sealed to their public key and overwritten in the same
 * update (migrateLegacyCopilotKeys). LEGACY_KEY_MIGRATION=off is the cutoff.
 */
import { createDecipheriv, createHash } from 'node:crypto';
import {
  clampUnlockTtlSeconds,
  isSealRecord,
  isSealedValue,
  sealToPublicKey,
  type SealRecord,
} from '@/lib/sealed/crypto';
import {
  lockOwner,
  lockOwnersWithPrefix,
  privateKeyFor,
  unlockOwner,
} from '@/lib/sealed/unlockStore';

export const COPILOT_PROVIDERS = ['anthropic', 'openai', 'elevenlabs'] as const;
export type CopilotKeyProvider = (typeof COPILOT_PROVIDERS)[number];

/** seal_version of a copilot_settings row whose keys are sealed to the owner (v2). */
export const COPILOT_SEAL_VERSION = 2;

/** The AAD field each key is bound to. */
export const keyField = (provider: CopilotKeyProvider): string => `copilot_${provider}_key`;

/** Is a stored value an old server-key blob (v1.<iv>.<tag>.<body>)? */
export const isLegacyValue = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('v1.');

export const legacyMigrationOn = (): boolean =>
  (process.env.LEGACY_KEY_MIGRATION ?? '').trim().toLowerCase() !== 'off';

// --- The per-meeting unlock -------------------------------------------------

const unlockId = (userId: string, sessionId: string) => `copilot:${userId}:${sessionId}`;

/** Hold the owner's private key for one meeting (memory only, TTL default 8h, max 7d). */
export function unlockCopilotKeys(
  userId: string,
  sessionId: string,
  privateKey: CryptoKey,
  ttlSeconds?: unknown
): { expiresAt: number } {
  return unlockOwner(unlockId(userId, sessionId), privateKey, clampUnlockTtlSeconds(ttlSeconds));
}

export function copilotPrivateKey(userId: string, sessionId: string): CryptoKey | null {
  if (!sessionId) return null;
  return privateKeyFor(unlockId(userId, sessionId));
}

/** Drop one meeting's unlock (copilot stopped, meeting ended). */
export function lockCopilotKeys(userId: string, sessionId: string): void {
  lockOwner(unlockId(userId, sessionId));
}

/** Drop every meeting unlock of one owner (Lock, passphrase reset). */
export function lockAllCopilotKeys(userId: string): number {
  return lockOwnersWithPrefix(`copilot:${userId}:`);
}

// --- Seal record ------------------------------------------------------------

export async function loadSealWith(db: any, userId: string): Promise<SealRecord | null> {
  const { data } = await db
    .from('user_key_seals')
    .select('seal')
    .eq('user_id', userId)
    .maybeSingle();
  const seal = data?.seal;
  return isSealRecord(seal) ? seal : null;
}

// --- Legacy v1 (read-only, migration only) ---------------------------------

const TAG_BYTES = 16;

function legacySecretKey(): Buffer | null {
  const secret = process.env.COPILOT_KEYS_SECRET ?? '';
  if (secret.length < 32) return null;
  return createHash('sha256').update(`pairux-copilot-keys:${secret}`).digest();
}

/** Open a v1 blob. Only migrateLegacyCopilotKeys calls this; it never feeds a provider. */
export function openLegacyKey(sealed: string, key: Buffer): string {
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

/**
 * One-shot: re-seal this owner's v1 keys to their public key and overwrite the
 * legacy ciphertext in the same update. Runs only in the owner's own request
 * (key passphrase setup / unlock, copilot settings, copilot start). Returns the
 * number of keys migrated; 0 when the switch is off or nothing is legacy.
 * A v1 value that cannot be opened is left as is (reported, never deleted).
 */
export async function migrateLegacyCopilotKeys(
  db: any,
  userId: string,
  publicKey: string,
  legacyKey: Buffer | null = legacySecretKey()
): Promise<number> {
  if (!legacyMigrationOn() || !legacyKey) return 0;
  const { data } = await db
    .from('copilot_settings')
    .select('anthropic_key, openai_key, elevenlabs_key')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return 0;
  const patch: Record<string, unknown> = {};
  let moved = 0;
  for (const provider of COPILOT_PROVIDERS) {
    const stored = data[`${provider}_key`];
    if (!isLegacyValue(stored)) continue;
    let plain: string;
    try {
      plain = openLegacyKey(stored, legacyKey);
    } catch {
      console.error(`[copilot] legacy ${provider} key could not be opened; left for review`);
      continue;
    }
    patch[`${provider}_key`] = await sealToPublicKey(publicKey, plain, userId, keyField(provider));
    moved++;
  }
  if (!moved) return 0;
  const left = COPILOT_PROVIDERS.some(
    (provider) => isLegacyValue(data[`${provider}_key`]) && !patch[`${provider}_key`]
  );
  if (!left) patch.seal_version = COPILOT_SEAL_VERSION;
  patch.updated_at = new Date().toISOString();
  const { error } = await db.from('copilot_settings').update(patch).eq('user_id', userId);
  if (error) throw new Error(`Migrating copilot keys failed: ${String(error.message)}`);
  return moved;
}

/**
 * After a passphrase reset the old private key is gone, so keys sealed to it
 * can never open: clear them (the owner re-enters them).
 */
export async function dropSealedCopilotKeys(db: any, userId: string): Promise<void> {
  const { data } = await db
    .from('copilot_settings')
    .select('anthropic_key, openai_key, elevenlabs_key')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return;
  const patch: Record<string, unknown> = {};
  for (const provider of COPILOT_PROVIDERS)
    if (isSealedValue(data[`${provider}_key`])) {
      patch[`${provider}_key`] = null;
      patch[`${provider}_last4`] = null;
    }
  if (!Object.keys(patch).length) return;
  patch.updated_at = new Date().toISOString();
  await db.from('copilot_settings').update(patch).eq('user_id', userId);
}
