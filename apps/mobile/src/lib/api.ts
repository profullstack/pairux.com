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
import { getValidAccessToken } from './auth-session';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  failureKind?: 'rejected' | 'unknown';
}

export async function getAuthToken(): Promise<string | null> {
  // Refreshes through /api/auth/refresh when the stored token is expired.
  return getValidAccessToken();
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
        return { error: 'Not authenticated', failureKind: 'rejected' };
      }
      headers.Authorization = `Bearer ${token}`;
    }

    // An auth refresh may finish after the caller has abandoned its request.
    if (options.signal?.aborted) return { error: 'Request cancelled', failureKind: 'unknown' };
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok) {
      return {
        error: data.error ?? `Request failed with status ${String(response.status)}`,
        failureKind: [400, 401, 403, 404, 413, 422, 429].includes(response.status)
          ? 'rejected'
          : 'unknown',
      };
    }

    return data;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      failureKind: 'unknown',
    };
  }
}
