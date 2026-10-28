/**
 * Client side: turn what the owner typed (key passphrase or recovery key) into
 * the base64 data key for an unlock request. Runs in the browser or the
 * desktop renderer (WebCrypto); the typed secret never leaves it. Relative
 * imports only, so the desktop app can bundle this file too.
 */
import {
  bytesToBase64,
  isSealRecord,
  unlockSeal,
  unlockSealWithRecovery,
  wipe,
  WrongPassphraseError,
} from './crypto';

/** A recovery key as encodeRecoveryKey prints it: groups of 4, dash separated. */
const RECOVERY_KEY = /^[A-Z0-9]{4}(?:-[A-Z0-9]{1,4}){7,}$/i;

export async function dataKeyFromSecret(
  seal: unknown,
  secret: string,
  userId: string
): Promise<string> {
  if (!isSealRecord(seal)) throw new Error('No key passphrase is set up yet.');
  const typed = secret.trim();
  let dek: Uint8Array | null = null;
  try {
    dek = RECOVERY_KEY.test(typed)
      ? await unlockSealWithRecovery(seal, typed, userId)
      : await unlockSeal(seal, secret, userId);
    return bytesToBase64(dek);
  } catch (error) {
    if (error instanceof WrongPassphraseError) throw new Error('Wrong key passphrase.');
    throw error;
  } finally {
    wipe(dek);
  }
}
