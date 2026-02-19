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

// --- Remembered credentials (separate from session tokens) ---

const CREDENTIALS_FILE = 'credentials.enc';

function getCredentialsPath(): string {
  return join(app.getPath('userData'), CREDENTIALS_FILE);
}

export interface StoredCredentials {
  email: string;
  password: string;
}

export function storeCredentials(credentials: StoredCredentials): void {
  const credentialsPath = getCredentialsPath();

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
    writeFileSync(credentialsPath, encrypted);
  } else {
    console.warn('[Auth] Encryption not available, storing credentials in plain text');
    writeFileSync(credentialsPath, JSON.stringify(credentials));
  }
}

export function getStoredCredentials(): StoredCredentials | null {
  const credentialsPath = getCredentialsPath();
  if (!existsSync(credentialsPath)) return null;

  try {
    const data = readFileSync(credentialsPath);

    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(data);
      return JSON.parse(decrypted) as StoredCredentials;
    } else {
      return JSON.parse(data.toString()) as StoredCredentials;
    }
  } catch (error) {
    console.error('[Auth] Failed to read stored credentials:', error);
    return null;
  }
}

export function clearStoredCredentials(): void {
  const credentialsPath = getCredentialsPath();
  if (existsSync(credentialsPath)) {
    unlinkSync(credentialsPath);
  }
}
