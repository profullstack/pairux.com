'use client';

// The YouTube refresh token is sealed under a passphrase only you know. All
// passphrase work happens here in the browser; the server gets the seal
// (ciphertext + public key) and, to unlock, the derived data key — never the
// passphrase. Unlocked = PairUX can auto go-live for you until the unlock
// runs out (max 7 days) or you lock it.

import { useCallback, useEffect, useState } from 'react';
import {
  bytesToBase64,
  createSeal,
  unlockSeal,
  unlockSealWithRecovery,
  wipe,
  MIN_PASSPHRASE_LENGTH,
  type SealRecord,
} from '@/lib/sealed/crypto';

interface KeysState {
  userId: string;
  seal: SealRecord | null;
  unlocked: boolean;
  expiresAt: string | null;
  state: 'setup_required' | 'locked' | 'unlocked';
}

const TTLS: [string, number][] = [
  ['8 hours', 8 * 3600],
  ['1 day', 86400],
  ['7 days (max)', 7 * 86400],
];

function sealOf(k: KeysState): SealRecord {
  if (!k.seal) throw new Error('No key passphrase set up yet.');
  return k.seal;
}

export function YouTubeKeys({ onChange }: { onChange?: (state: KeysState['state']) => void }) {
  const [keys, setKeys] = useState<KeysState | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [recovery, setRecovery] = useState('');
  const [ttl, setTtl] = useState(7 * 86400);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [shownRecovery, setShownRecovery] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/keys');
    if (res.ok) {
      const json = (await res.json()) as { data: KeysState };
      setKeys(json.data);
      onChange?.(json.data.state);
    }
  }, [onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${String(res.status)}`);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      const err = e as Error;
      setMsg(err.name === 'WrongPassphraseError' ? 'Wrong passphrase.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!keys) return null;
  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm';
  const button =
    'rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50';
  const ttlPicker = (
    <select
      className="rounded-lg border border-gray-200 px-2 py-2 text-sm"
      value={ttl}
      onChange={(e) => {
        setTtl(Number(e.target.value));
      }}
    >
      {TTLS.map(([label, s]) => (
        <option key={s} value={s}>
          {`Unlocked for ${label}`}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4 text-sm">
      {shownRecovery && (
        <div className="rounded-lg border border-amber-400 p-3">
          <p className="font-medium">Recovery key (shown once). Keep it somewhere safe:</p>
          <code className="mt-1 block font-mono break-all">{shownRecovery}</code>
          <button
            type="button"
            className={`${button} mt-2`}
            onClick={() => {
              setShownRecovery(null);
            }}
          >
            I saved it
          </button>
        </div>
      )}
      {keys.state === 'setup_required' && (
        <div className="space-y-2">
          <p className="text-gray-600">
            First set a key passphrase. Your YouTube token is sealed under it and PairUX keeps no
            key that can open it. If you lose both the passphrase and the recovery key, just
            reconnect YouTube.
          </p>
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            placeholder="Passphrase (10+ characters)"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
            }}
          />
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            placeholder="Repeat passphrase"
            value={pass2}
            onChange={(e) => {
              setPass2(e.target.value);
            }}
          />
          <div className="flex gap-2">
            {ttlPicker}
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (pass.length < MIN_PASSPHRASE_LENGTH)
                    throw new Error(`Use at least ${String(MIN_PASSPHRASE_LENGTH)} characters.`);
                  if (pass !== pass2) throw new Error('The two passphrases differ.');
                  const made = await createSeal(pass, keys.userId);
                  const dek = bytesToBase64(made.dek);
                  wipe(made.dek);
                  await post('/api/keys/setup', { seal: made.seal, dek, ttl_seconds: ttl });
                  setShownRecovery(made.recoveryKey);
                  setPass('');
                  setPass2('');
                })
              }
            >
              Set passphrase
            </button>
          </div>
        </div>
      )}
      {keys.state === 'locked' && (
        <div className="space-y-2">
          <p className="text-gray-600">
            Locked: auto go-live is paused until you unlock (after a server restart, too).
          </p>
          <input
            className={input}
            type="password"
            autoComplete="current-password"
            placeholder="Passphrase"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
            }}
          />
          <input
            className={`${input} font-mono`}
            placeholder="…or recovery key"
            value={recovery}
            onChange={(e) => {
              setRecovery(e.target.value);
            }}
          />
          <div className="flex gap-2">
            {ttlPicker}
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = recovery
                    ? await unlockSealWithRecovery(sealOf(keys), recovery, keys.userId)
                    : await unlockSeal(sealOf(keys), pass, keys.userId);
                  const dek = bytesToBase64(d);
                  wipe(d);
                  await post('/api/keys/unlock', { dek, ttl_seconds: ttl });
                  setPass('');
                  setRecovery('');
                })
              }
            >
              Unlock
            </button>
          </div>
        </div>
      )}
      {keys.state === 'unlocked' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">
            Auto go-live unlocked until{' '}
            {keys.expiresAt ? new Date(keys.expiresAt).toLocaleString() : ''}.
          </span>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              void run(() => post('/api/keys/lock', {}));
            }}
          >
            Lock
          </button>
        </div>
      )}
      {msg && <p className="text-red-600">{msg}</p>}
    </div>
  );
}
