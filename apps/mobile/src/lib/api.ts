/**
 * Base API client for the mobile app.
 *
 * Port of apps/desktop/src/renderer/lib/api.ts combined with the
 * auth header injection from apps/desktop/src/main/ipc/auth.ts.
 *
 * Mobile has no IPC layer — the API client calls fetch directly
 * with Bearer token from secure store.
 */
import { API_BASE_URL } from '../config';
import { getStoredAuth, isAuthExpired } from './secure-storage';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export async function getAuthToken(): Promise<string | null> {
  const stored = await getStoredAuth();
  if (!stored || isAuthExpired(stored)) return null;
  return stored.accessToken;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  requireAuth = true
): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    if (requireAuth) {
      const token = await getAuthToken();
      if (!token) {
        return { error: 'Not authenticated' };
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok) {
      return { error: data.error ?? `Request failed with status ${String(response.status)}` };
    }

    return data;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Network error' };
  }
}
