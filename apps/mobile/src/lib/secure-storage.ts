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
