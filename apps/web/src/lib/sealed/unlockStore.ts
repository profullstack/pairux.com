/**
 * In-process unlock store. Holds each unlocked owner's private key (a
 * non-extractable CryptoKey) in memory only: never the DB, Redis, disk, logs
 * or process.env. A restart empties it, so every owner is locked again and
 * their jobs wait ("locked: unlock to resume") until they unlock.
 *
 * Kept on globalThis so the Next server's route bundles share one store.
 */

import { clampUnlockTtlSeconds } from './crypto';

interface Entry {
  privateKey: CryptoKey;
  unlockedAt: number;
  expiresAt: number;
}

const KEY = Symbol.for('pairux.sealed.unlockStore');
type G = typeof globalThis & { [KEY]?: Map<string, Entry> };

function store(): Map<string, Entry> {
  const g = globalThis as G;
  const existing: Map<string, Entry> | undefined = g[KEY];
  if (existing) return existing;
  const created = new Map<string, Entry>();
  g[KEY] = created;
  return created;
}

export function unlockOwner(
  ownerId: string,
  privateKey: CryptoKey,
  ttlSeconds: number,
  now = Date.now()
): { expiresAt: number } {
  const ttl = clampUnlockTtlSeconds(ttlSeconds);
  const expiresAt = now + ttl * 1000;
  store().set(ownerId, { privateKey, unlockedAt: now, expiresAt });
  return { expiresAt };
}

export function lockOwner(ownerId: string): boolean {
  return store().delete(ownerId);
}

/** Drop every unlock whose owner id starts with `prefix` (a user's per-meeting copilot unlocks). */
export function lockOwnersWithPrefix(prefix: string): number {
  let n = 0;
  for (const id of [...store().keys()]) {
    if (id.startsWith(prefix)) {
      store().delete(id);
      n++;
    }
  }
  return n;
}

/** The owner's private key, or null when locked or expired (an expired entry is dropped). */
export function privateKeyFor(ownerId: string, now = Date.now()): CryptoKey | null {
  const e = store().get(ownerId);
  if (!e) return null;
  if (e.expiresAt <= now) {
    store().delete(ownerId);
    return null;
  }
  return e.privateKey;
}

export function isUnlocked(ownerId: string, now = Date.now()): boolean {
  return privateKeyFor(ownerId, now) !== null;
}

export function unlockStatus(
  ownerId: string,
  now = Date.now()
): { unlocked: boolean; unlockedAt: string | null; expiresAt: string | null } {
  const e = store().get(ownerId);
  if (!e || e.expiresAt <= now) {
    if (e) store().delete(ownerId);
    return { unlocked: false, unlockedAt: null, expiresAt: null };
  }
  return {
    unlocked: true,
    unlockedAt: new Date(e.unlockedAt).toISOString(),
    expiresAt: new Date(e.expiresAt).toISOString(),
  };
}

/** Test hook / simulated restart. */
export function clearAllUnlocks(): void {
  store().clear();
}

export function unlockedCount(now = Date.now()): number {
  let n = 0;
  for (const [id, e] of store()) {
    if (e.expiresAt > now) n++;
    else store().delete(id);
  }
  return n;
}
