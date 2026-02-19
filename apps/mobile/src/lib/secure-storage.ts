/**
 * Secure token storage using expo-secure-store.
 *
 * Mobile equivalent of the desktop app's Electron safeStorage
 * (apps/desktop/src/main/auth/secure-storage.ts).
 */
import * as SecureStore from 'expo-secure-store';

const AUTH_KEY = 'pairux_auth';

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

export async function storeAuth(auth: StoredAuth): Promise<void> {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth));
}

export async function getStoredAuth(): Promise<StoredAuth | null> {
  const data = await SecureStore.getItemAsync(AUTH_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as StoredAuth;
  } catch {
    return null;
  }
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_KEY);
}

export function isAuthExpired(auth: StoredAuth): boolean {
  // Consider expired if within 5 minutes of expiry
  return Date.now() >= auth.expiresAt - 5 * 60 * 1000;
}

// --- Remembered credentials (separate from session tokens) ---

const CREDENTIALS_KEY = 'pairux_credentials';

export interface StoredCredentials {
  email: string;
  password: string;
}

export async function storeCredentials(credentials: StoredCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  const data = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function clearStoredCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
}
