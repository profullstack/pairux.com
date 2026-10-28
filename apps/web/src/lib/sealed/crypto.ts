/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/restrict-plus-operands, @typescript-eslint/prefer-for-of -- shared seal-v2 module, byte-compatible with the copies in crawlproof/outreachgraph */
/**
 * User-held sealing for every secret a user gives PairUX (seal v2).
 *
 * Isomorphic: WebCrypto only, so the same file runs in the browser (setup,
 * unlock), the Next server, the worker and the CLI. Nothing stored on our
 * servers can open a sealed secret; the opening key comes from the user.
 *
 *   passphrase --PBKDF2-SHA256 600k, 16-byte salt--> ikm --HKDF--> KEK
 *   KEK wraps a random 32-byte data key (DEK)            -> seal.wrapped_dek
 *   recovery key --HKDF--> RKEK wraps the same DEK        -> seal.recovery_wrapped_dek
 *   DEK seals a fixed string                              -> seal.key_check
 *   DEK seals the private half of an ECDH P-256 key pair  -> seal.private_sealed
 *   the public half is stored in the clear                -> seal.public_key
 *
 * Every secret (OAuth token, app password, bot token, SMTP password, ...) is
 * sealed to the PUBLIC key (ephemeral ECDH + HKDF + AES-256-GCM, AAD binds
 * owner id + field). So the server can write a secret at any time (an OAuth
 * callback, a token refresh in the worker) but can read one back only while
 * the owner has unlocked: the browser/CLI derives the DEK from the passphrase
 * and sends the DEK (never the passphrase); the server opens the private key
 * with it and keeps that key in process memory with a TTL.
 */

export const SEAL_VERSION = 2;
export const SEALED_PREFIX = 'v2:';
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_CHECK_TEXT = 'pairux-key-check-v2';

export interface CipherBlob {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface SealKdf {
  alg: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
}

/** Stored in user_key_seal.seal (jsonb). Nothing in here opens without the passphrase or recovery key. */
export interface SealRecord {
  v: 2;
  kdf: SealKdf;
  wrapped_dek: CipherBlob;
  recovery_wrapped_dek: CipherBlob | null;
  key_check: CipherBlob;
  /** base64 raw uncompressed P-256 public key */
  public_key: string;
  /** pkcs8 private key, sealed under the DEK */
  private_sealed: CipherBlob;
}

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto (crypto.subtle) is not available');
  return c.subtle;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

type Bytes = Uint8Array<ArrayBuffer>;

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function base64ToBytes(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function wipe(bytes: Uint8Array | null | undefined): void {
  if (bytes) bytes.fill(0);
}

function aad(ownerId: string, field: string): Bytes {
  if (!ownerId) throw new Error('ownerId required for AAD');
  if (!field) throw new Error('field required for AAD');
  return enc.encode(`pairux:v2:${ownerId}:${field}`);
}

async function gcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  ad: Uint8Array
): Promise<CipherBlob> {
  const iv = randomBytes(IV_BYTES);
  const sealed = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv, additionalData: buf(ad), tagLength: TAG_BYTES * 8 },
      key,
      buf(plaintext)
    )
  );
  return {
    ciphertext: bytesToBase64(sealed.slice(0, sealed.length - TAG_BYTES)),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(sealed.slice(sealed.length - TAG_BYTES)),
  };
}

async function gcmDecrypt(key: CryptoKey, blob: CipherBlob, ad: Uint8Array): Promise<Bytes> {
  const ct = base64ToBytes(blob.ciphertext);
  const tag = base64ToBytes(blob.tag);
  const joined = new Uint8Array(ct.length + tag.length);
  joined.set(ct, 0);
  joined.set(tag, ct.length);
  const out = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(blob.iv),
      additionalData: buf(ad),
      tagLength: TAG_BYTES * 8,
    },
    key,
    buf(joined)
  );
  return new Uint8Array(out);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error(`data key must be 32 bytes (got ${raw.length})`);
  return subtle().importKey('raw', buf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function hkdfAesKey(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', buf(ikm), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(enc.encode(info)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Passphrase -> KEK. PBKDF2-SHA256 (>= 600k) then HKDF, matching OpenCreds. */
export async function deriveKek(passphrase: string, kdf: SealKdf): Promise<CryptoKey> {
  if (kdf.alg !== 'PBKDF2-SHA256') throw new Error(`unsupported kdf ${kdf.alg}`);
  if (kdf.iterations < MIN_PBKDF2_ITERATIONS) throw new Error('kdf iterations below policy');
  const salt = base64ToBytes(kdf.salt);
  const pw = await subtle().importKey(
    'raw',
    buf(enc.encode(passphrase.normalize('NFKC'))),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = new Uint8Array(
    await subtle().deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: kdf.iterations },
      pw,
      256
    )
  );
  try {
    return await hkdfAesKey(bits, salt, 'pairux/kek/v2');
  } finally {
    wipe(bits);
  }
}

async function deriveRecoveryKek(recoveryKey: string): Promise<CryptoKey> {
  const raw = decodeRecoveryKey(recoveryKey);
  try {
    return await hkdfAesKey(raw, enc.encode('pairux/recovery'), 'pairux/recovery-kek/v2');
  } finally {
    wipe(raw);
  }
}

const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

export function encodeRecoveryKey(raw: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of raw) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function decodeRecoveryKey(text: string): Bytes {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid recovery key');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length < 32) throw new Error('invalid recovery key');
  return new Uint8Array(out.slice(0, 32));
}

export interface CreatedSeal {
  dek: Bytes;
  seal: SealRecord;
  /** Show to the user exactly once; never stored. */
  recoveryKey: string;
}

/** First-time setup (browser or CLI): new DEK + key pair, wrapped under the passphrase and a recovery key. */
export async function createSeal(
  passphrase: string,
  ownerId: string,
  iterations = PBKDF2_ITERATIONS
): Promise<CreatedSeal> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const dek = randomBytes(32);
  const recoveryRaw = randomBytes(32);
  const recoveryKey = encodeRecoveryKey(recoveryRaw);
  wipe(recoveryRaw);

  const kdf: SealKdf = { alg: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(randomBytes(16)) };
  const kek = await deriveKek(passphrase, kdf);
  const wrapped_dek = await gcmEncrypt(kek, dek, aad(ownerId, 'dek:passphrase'));
  const rkek = await deriveRecoveryKek(recoveryKey);
  const recovery_wrapped_dek = await gcmEncrypt(rkek, dek, aad(ownerId, 'dek:recovery'));
  const dk = await aesKey(dek);
  const key_check = await gcmEncrypt(dk, enc.encode(KEY_CHECK_TEXT), aad(ownerId, 'key_check'));
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const priv = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const private_sealed = await gcmEncrypt(dk, priv, aad(ownerId, 'private_key'));
  wipe(priv);
  return {
    dek,
    recoveryKey,
    seal: {
      v: 2,
      kdf,
      wrapped_dek,
      recovery_wrapped_dek,
      key_check,
      public_key: bytesToBase64(pub),
      private_sealed,
    },
  };
}

/** Change passphrase: same DEK and key pair, new salt and wrap. */
export async function rewrapSeal(
  dek: Uint8Array,
  seal: SealRecord,
  newPassphrase: string,
  ownerId: string
): Promise<SealRecord> {
  if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  if (!(await verifyDataKey(dek, seal, ownerId)))
    throw new WrongPassphraseError('key check failed');
  const kdf: SealKdf = {
    alg: 'PBKDF2-SHA256',
    iterations: Math.max(seal.kdf.iterations, PBKDF2_ITERATIONS),
    salt: bytesToBase64(randomBytes(16)),
  };
  const kek = await deriveKek(newPassphrase, kdf);
  const wrapped_dek = await gcmEncrypt(kek, dek, aad(ownerId, 'dek:passphrase'));
  return { ...seal, kdf, wrapped_dek };
}

export class WrongPassphraseError extends Error {
  constructor(msg = 'wrong passphrase') {
    super(msg);
    this.name = 'WrongPassphraseError';
  }
}

/** Passphrase -> DEK (client side). */
export async function unlockSeal(
  seal: SealRecord,
  passphrase: string,
  ownerId: string
): Promise<Bytes> {
  const kek = await deriveKek(passphrase, seal.kdf);
  let dek: Bytes;
  try {
    dek = await gcmDecrypt(kek, seal.wrapped_dek, aad(ownerId, 'dek:passphrase'));
  } catch {
    throw new WrongPassphraseError();
  }
  if (!(await verifyDataKey(dek, seal, ownerId)))
    throw new WrongPassphraseError('key check failed');
  return dek;
}

export async function unlockSealWithRecovery(
  seal: SealRecord,
  recoveryKey: string,
  ownerId: string
): Promise<Bytes> {
  if (!seal.recovery_wrapped_dek) throw new WrongPassphraseError('no recovery key on file');
  let dek: Bytes;
  try {
    const rkek = await deriveRecoveryKek(recoveryKey);
    dek = await gcmDecrypt(rkek, seal.recovery_wrapped_dek, aad(ownerId, 'dek:recovery'));
  } catch {
    throw new WrongPassphraseError('wrong recovery key');
  }
  if (!(await verifyDataKey(dek, seal, ownerId)))
    throw new WrongPassphraseError('key check failed');
  return dek;
}

export async function verifyDataKey(
  dek: Uint8Array,
  seal: Pick<SealRecord, 'key_check'>,
  ownerId: string
): Promise<boolean> {
  if (dek.length !== 32) return false;
  try {
    const out = await gcmDecrypt(await aesKey(dek), seal.key_check, aad(ownerId, 'key_check'));
    return dec.decode(out) === KEY_CHECK_TEXT;
  } catch {
    return false;
  }
}

/** Server side, at unlock: DEK -> non-extractable private key. Throws WrongPassphraseError on a bad DEK. */
export async function openPrivateKey(
  dek: Uint8Array,
  seal: SealRecord,
  ownerId: string
): Promise<CryptoKey> {
  if (!(await verifyDataKey(dek, seal, ownerId)))
    throw new WrongPassphraseError('key check failed');
  const pkcs8 = await gcmDecrypt(
    await aesKey(dek),
    seal.private_sealed,
    aad(ownerId, 'private_key')
  );
  try {
    return await subtle().importKey(
      'pkcs8',
      buf(pkcs8),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
  } finally {
    wipe(pkcs8);
  }
}

async function boxKey(
  shared: Uint8Array,
  epk: Uint8Array,
  ownerId: string,
  field: string
): Promise<CryptoKey> {
  return hkdfAesKey(shared, epk, `pairux/box/v2/${ownerId}/${field}`);
}

/** Seal a secret to the owner's public key. Output: "v2:" + base64(JSON {e, c, i, t}). */
export async function sealToPublicKey(
  publicKeyB64: string,
  plaintext: string,
  ownerId: string,
  field: string
): Promise<string> {
  const recipient = await subtle().importKey(
    'raw',
    buf(base64ToBytes(publicKeyB64)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256)
  );
  const epk = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  try {
    const key = await boxKey(shared, epk, ownerId, field);
    const blob = await gcmEncrypt(key, enc.encode(plaintext), aad(ownerId, field));
    const body = JSON.stringify({
      e: bytesToBase64(epk),
      c: blob.ciphertext,
      i: blob.iv,
      t: blob.tag,
    });
    return SEALED_PREFIX + btoa(body);
  } finally {
    wipe(shared);
  }
}

export function isSealedValue(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(SEALED_PREFIX);
}

/** Open a "v2:" value with the owner's private key (only present while unlocked). */
export async function openWithPrivateKey(
  privateKey: CryptoKey,
  sealed: string,
  ownerId: string,
  field: string
): Promise<string> {
  if (!isSealedValue(sealed)) throw new Error('not a sealed v2 value');
  const body = JSON.parse(atob(sealed.slice(SEALED_PREFIX.length))) as {
    e: string;
    c: string;
    i: string;
    t: string;
  };
  const epk = base64ToBytes(body.e);
  const pub = await subtle().importKey(
    'raw',
    buf(epk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const shared = new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: pub }, privateKey, 256)
  );
  try {
    const key = await boxKey(shared, epk, ownerId, field);
    const out = await gcmDecrypt(
      key,
      { ciphertext: body.c, iv: body.i, tag: body.t },
      aad(ownerId, field)
    );
    const text = dec.decode(out);
    wipe(out);
    return text;
  } finally {
    wipe(shared);
  }
}

export function isCipherBlob(v: unknown): v is CipherBlob {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.ciphertext === 'string' &&
    typeof b.iv === 'string' &&
    typeof b.tag === 'string' &&
    b.iv.length > 0 &&
    b.tag.length > 0
  );
}

export function isSealRecord(v: unknown): v is SealRecord {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const kdf = s.kdf as Record<string, unknown> | undefined;
  return (
    s.v === 2 &&
    !!kdf &&
    kdf.alg === 'PBKDF2-SHA256' &&
    typeof kdf.iterations === 'number' &&
    kdf.iterations >= MIN_PBKDF2_ITERATIONS &&
    typeof kdf.salt === 'string' &&
    isCipherBlob(s.wrapped_dek) &&
    isCipherBlob(s.key_check) &&
    isCipherBlob(s.private_sealed) &&
    (s.recovery_wrapped_dek === null || isCipherBlob(s.recovery_wrapped_dek)) &&
    typeof s.public_key === 'string' &&
    s.public_key.length > 0
  );
}

// ----------------------------------------------------- unlock TTL policy ---

export const UNLOCK_DEFAULT_TTL_SECONDS = 8 * 3600;
export const OPERATOR_DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
export const UNLOCK_MAX_TTL_SECONDS = 7 * 24 * 3600;
export const UNLOCK_MIN_TTL_SECONDS = 60;

export function clampUnlockTtlSeconds(v: unknown, fallback = UNLOCK_DEFAULT_TTL_SECONDS): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(UNLOCK_MAX_TTL_SECONDS, Math.max(UNLOCK_MIN_TTL_SECONDS, Math.floor(n)));
}

/** "8h", "30m", "7d", "3600" -> seconds (clamped). */
export function parseTtl(text: string | undefined, fallback = UNLOCK_DEFAULT_TTL_SECONDS): number {
  if (!text) return fallback;
  const m = /^(\d+)\s*([smhd]?)$/i.exec(text.trim());
  if (!m) throw new Error(`bad ttl "${text}" (use e.g. 30m, 8h, 7d)`);
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[
    (m[2] ?? '').toLowerCase() as '' | 's' | 'm' | 'h' | 'd'
  ];
  return clampUnlockTtlSeconds(Number(m[1]) * mult, fallback);
}
