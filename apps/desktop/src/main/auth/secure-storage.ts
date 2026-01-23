import { safeStorage, app } from 'electron';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const AUTH_FILE = 'auth.enc';

function getAuthPath(): string {
  return join(app.getPath('userData'), AUTH_FILE);
}

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

export function storeAuth(auth: StoredAuth): void {
  const authPath = getAuthPath();

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(JSON.stringify(auth));
    writeFileSync(authPath, encrypted);
  } else {
    // Fallback to plain storage (less secure, but functional)
    console.warn('[Auth] Encryption not available, storing auth in plain text');
    writeFileSync(authPath, JSON.stringify(auth));
  }
}

export function getStoredAuth(): StoredAuth | null {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) return null;

  try {
    const data = readFileSync(authPath);

    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(data);
      return JSON.parse(decrypted) as StoredAuth;
    } else {
      // Fallback: try to parse as plain JSON
      return JSON.parse(data.toString()) as StoredAuth;
    }
  } catch (error) {
    console.error('[Auth] Failed to read stored auth:', error);
    return null;
  }
}

export function clearStoredAuth(): void {
  const authPath = getAuthPath();
  if (existsSync(authPath)) {
    unlinkSync(authPath);
  }
}

export function isAuthExpired(auth: StoredAuth): boolean {
  // Consider expired if within 5 minutes of expiry
  return Date.now() >= auth.expiresAt - 5 * 60 * 1000;
}
