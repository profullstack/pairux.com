/**
 * Server side of seal v2 for PairUX (the YouTube refresh token).
 *
 * seal(): to the user's PUBLIC key, no unlock needed (OAuth callback).
 * open(): needs the user's private key, held in this process's memory only
 * while they are unlocked (Settings > YouTube > Unlock, TTL max 7 days).
 * Locked = auto go-live is skipped, never crashes; plaintext is never used.
 */
import { serviceClient } from '@/lib/supabase/service';
import {
  isSealRecord,
  isSealedValue,
  openWithPrivateKey,
  sealToPublicKey,
  type SealRecord,
} from './crypto';
import { privateKeyFor } from './unlockStore';

export async function loadSeal(userId: string): Promise<SealRecord | null> {
  const { data } = await serviceClient()
    .from('user_key_seals' as never)
    .select('seal')
    .eq('user_id', userId)
    .maybeSingle();
  const seal = (data as { seal?: unknown } | null)?.seal;
  return isSealRecord(seal) ? seal : null;
}

export async function sealForUser(
  userId: string,
  plaintext: string,
  field: string
): Promise<string | null> {
  const seal = await loadSeal(userId);
  if (!seal) return null;
  return sealToPublicKey(seal.public_key, plaintext, userId, field);
}

/** The opened secret, or null when the user is locked / the value is not sealed. */
export async function openForUser(
  userId: string,
  stored: string,
  field: string
): Promise<string | null> {
  if (!isSealedValue(stored)) return null;
  const key = privateKeyFor(userId);
  if (!key) return null;
  return openWithPrivateKey(key, stored, userId, field);
}
