import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeal, isSealedValue, openPrivateKey } from '@/lib/sealed/crypto';
import { clearAllUnlocks, isUnlocked, lockOwner } from '@/lib/sealed/unlockStore';
import { CopilotAccounts, KeyPassphraseRequiredError } from './account';
import {
  copilotPrivateKey,
  dropSealedCopilotKeys,
  lockAllCopilotKeys,
  lockCopilotKeys,
  migrateLegacyCopilotKeys,
  unlockCopilotKeys,
} from './keys';
import { CopilotLlm } from './llm';

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => ({}) }));

/** Just enough of the Supabase client for copilot_settings + user_key_seals. */
function fakeDb() {
  type Table = Map<string, Record<string, unknown>>;
  const tables = {
    copilot_settings: new Map() as Table,
    user_key_seals: new Map() as Table,
  };
  const other = new Map<string, Table>();
  const from = (name: string) => {
    const table: Table =
      name === 'copilot_settings' || name === 'user_key_seals'
        ? tables[name]
        : (other.get(name) ?? other.set(name, new Map()).get(name) ?? new Map());
    let filterUser = '';
    let patch: Record<string, unknown> | null = null;
    const api = {
      select: () => api,
      eq: (_col: string, value: string) => {
        filterUser = value;
        if (patch) {
          const row = table.get(filterUser);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        }
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: table.get(filterUser) ?? null }),
      upsert: (row: Record<string, unknown>) => {
        const id = row.user_id as string;
        table.set(id, { ...(table.get(id) ?? {}), ...row });
        return Promise.resolve({ error: null });
      },
      update: (next: Record<string, unknown>) => {
        patch = next;
        return api;
      },
    };
    return api;
  };
  return { from, tables };
}

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = 'sess-1';
const ANTHROPIC = 'sk-ant-api03-abcdefghijklmnopqrstuv';

function legacyKey(secret: string): Buffer {
  return createHash('sha256').update(`pairux-copilot-keys:${secret}`).digest();
}
function legacySeal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', ...[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url'))].join(
    '.'
  );
}

async function withSeal(db: ReturnType<typeof fakeDb>) {
  const made = await createSeal('correct horse battery', USER);
  db.tables.user_key_seals.set(USER, { user_id: USER, seal: made.seal });
  const privateKey = await openPrivateKey(made.dek, made.seal, USER);
  return { seal: made.seal, privateKey };
}

describe('copilot own keys, sealed to the owner', () => {
  const env = { ...process.env };
  beforeEach(() => {
    clearAllUnlocks();
  });
  afterEach(() => {
    process.env = { ...env };
    clearAllUnlocks();
  });

  it('refuses to save a key before a key passphrase is set', async () => {
    const db = fakeDb();
    const accounts = new CopilotAccounts(db);
    await expect(
      accounts.saveSettings(USER, { keys: { anthropic: ANTHROPIC } })
    ).rejects.toBeInstanceOf(KeyPassphraseRequiredError);
    // Mode and role still save without one.
    await expect(accounts.saveSettings(USER, { mode: 'byok' })).resolves.toBeTruthy();
  });

  it('stores only a v2 value and opens it only for the unlocked meeting', async () => {
    const db = fakeDb();
    const { privateKey } = await withSeal(db);
    const accounts = new CopilotAccounts(db);
    const pub = await accounts.saveSettings(USER, { keys: { anthropic: ANTHROPIC } });
    expect(pub.keys.anthropic).toEqual({ set: true, last4: 'stuv' });
    expect(pub.passphraseSet).toBe(true);
    const row = db.tables.copilot_settings.get(USER) ?? {};
    expect(isSealedValue(row.anthropic_key)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(ANTHROPIC);
    expect(row.seal_version).toBe(2);

    // Locked: nothing opens, and it says so.
    const locked = await accounts.settingsFor(USER, SESSION);
    expect(locked.keys).toEqual({});
    expect(locked.keysState).toBe('locked');

    unlockCopilotKeys(USER, SESSION, privateKey);
    accounts.forget(USER);
    const open = await accounts.settingsFor(USER, SESSION);
    expect(open.keys.anthropic).toBe(ANTHROPIC);
    expect(open.keysState).toBe('unlocked');

    // Another meeting, or no meeting, stays locked.
    expect((await accounts.settingsFor(USER, 'other')).keys).toEqual({});
    expect((await accounts.settingsFor(USER)).keys).toEqual({});
  });

  it('a value copied to another user or field does not open', async () => {
    const db = fakeDb();
    const { privateKey } = await withSeal(db);
    const accounts = new CopilotAccounts(db);
    await accounts.saveSettings(USER, { keys: { anthropic: ANTHROPIC } });
    const row = db.tables.copilot_settings.get(USER) ?? {};
    row.openai_key = row.anthropic_key; // wrong field (AAD)
    unlockCopilotKeys(USER, SESSION, privateKey);
    const settings = await accounts.settingsFor(USER, SESSION);
    expect(settings.keys.anthropic).toBe(ANTHROPIC);
    expect(settings.keys.openai).toBeUndefined();
  });

  it('meeting unlocks expire, lock, and vanish on restart', async () => {
    const db = fakeDb();
    const { privateKey } = await withSeal(db);
    const { expiresAt } = unlockCopilotKeys(USER, SESSION, privateKey, 60);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
    expect(copilotPrivateKey(USER, SESSION)).not.toBeNull();
    lockCopilotKeys(USER, SESSION);
    expect(copilotPrivateKey(USER, SESSION)).toBeNull();

    unlockCopilotKeys(USER, 'a', privateKey);
    unlockCopilotKeys(USER, 'b', privateKey);
    unlockCopilotKeys('someone-else', 'a', privateKey);
    expect(lockAllCopilotKeys(USER)).toBe(2);
    expect(copilotPrivateKey('someone-else', 'a')).not.toBeNull();

    clearAllUnlocks(); // a restart
    expect(copilotPrivateKey('someone-else', 'a')).toBeNull();

    vi.useFakeTimers();
    try {
      unlockCopilotKeys(USER, SESSION, privateKey, 60);
      vi.advanceTimersByTime(61_000);
      expect(copilotPrivateKey(USER, SESSION)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a meeting unlock is separate from the YouTube (owner) unlock', async () => {
    const db = fakeDb();
    const { privateKey } = await withSeal(db);
    unlockCopilotKeys(USER, SESSION, privateKey);
    expect(isUnlocked(USER)).toBe(false);
    lockOwner(USER);
    expect(copilotPrivateKey(USER, SESSION)).not.toBeNull();
  });

  it('never uses a legacy server-key value, even with COPILOT_KEYS_SECRET set', async () => {
    const secret = 'x'.repeat(40);
    process.env.COPILOT_KEYS_SECRET = secret;
    const db = fakeDb();
    db.tables.copilot_settings.set(USER, {
      user_id: USER,
      mode: 'cloud',
      role: 'general',
      anthropic_key: legacySeal(ANTHROPIC, legacyKey(secret)),
    });
    const accounts = new CopilotAccounts(db);
    const settings = await accounts.settingsFor(USER, SESSION);
    expect(settings.keys).toEqual({});
    expect(settings.keysState).toBe('legacy');
    expect((await accounts.publicSettings(USER)).legacyKeys).toBe(1);
  });

  it('migrates legacy values once to the owner seal, in place', async () => {
    const secret = 'y'.repeat(40);
    const db = fakeDb();
    const { seal, privateKey } = await withSeal(db);
    db.tables.copilot_settings.set(USER, {
      user_id: USER,
      anthropic_key: legacySeal(ANTHROPIC, legacyKey(secret)),
      openai_key: 'v1.garbage.garbage.garbage',
    });
    const moved = await migrateLegacyCopilotKeys(db, USER, seal.public_key, legacyKey(secret));
    expect(moved).toBe(1);
    const row = db.tables.copilot_settings.get(USER) ?? {};
    expect(isSealedValue(row.anthropic_key)).toBe(true);
    // Unreadable legacy data is kept for review, never deleted; the row is not marked v2.
    expect(row.openai_key).toBe('v1.garbage.garbage.garbage');
    expect(row.seal_version).toBeUndefined();
    // Running again moves nothing.
    expect(await migrateLegacyCopilotKeys(db, USER, seal.public_key, legacyKey(secret))).toBe(0);

    unlockCopilotKeys(USER, SESSION, privateKey);
    const accounts = new CopilotAccounts(db);
    expect((await accounts.settingsFor(USER, SESSION)).keys.anthropic).toBe(ANTHROPIC);
  });

  it('LEGACY_KEY_MIGRATION=off is the cutoff', async () => {
    process.env.LEGACY_KEY_MIGRATION = 'off';
    const secret = 'z'.repeat(40);
    const db = fakeDb();
    const { seal } = await withSeal(db);
    const legacy = legacySeal(ANTHROPIC, legacyKey(secret));
    db.tables.copilot_settings.set(USER, { user_id: USER, anthropic_key: legacy });
    expect(await migrateLegacyCopilotKeys(db, USER, seal.public_key, legacyKey(secret))).toBe(0);
    expect(db.tables.copilot_settings.get(USER)?.anthropic_key).toBe(legacy);
  });

  it('a passphrase reset clears keys sealed to the old key', async () => {
    const db = fakeDb();
    await withSeal(db);
    const accounts = new CopilotAccounts(db);
    await accounts.saveSettings(USER, { keys: { anthropic: ANTHROPIC } });
    await dropSealedCopilotKeys(db, USER);
    const row = db.tables.copilot_settings.get(USER) ?? {};
    expect(row.anthropic_key).toBeNull();
    expect(row.anthropic_last4).toBeNull();
  });

  it('locked own keys never fall through to our paid provider', () => {
    process.env.ANTHROPIC_API_KEY = 'ours';
    const llm = new CopilotLlm({} as CopilotAccounts);
    const ctx = { userId: USER, sessionId: SESSION, keys: {}, admin: false };
    expect(llm.steps({ ...ctx, mode: 'cloud' }).some((s) => s.kind === 'ours')).toBe(true);
    expect(
      llm.steps({ ...ctx, mode: 'cloud', keysLocked: true }).some((s) => s.kind === 'ours')
    ).toBe(false);
    expect(
      llm.steps({ ...ctx, mode: 'auto', keysLocked: true }).some((s) => s.kind === 'ours')
    ).toBe(false);
  });
});
