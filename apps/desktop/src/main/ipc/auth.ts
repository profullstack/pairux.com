import { apiFetch } from '../lib/apiFetch';
import { ipcMain, shell } from 'electron';
import {
  storeAuth,
  getStoredAuth,
  clearStoredAuth,
  isAuthExpired,
  storeCredentials,
  getStoredCredentials,
  clearStoredCredentials,
  getValidAuth,
} from '../auth/secure-storage';
import type { Profile } from '@pairux/shared-types';
import { APP_URL, API_BASE_URL } from '../../shared/config';
import { formatNetworkError } from './network-error';
import { clearPlanCache } from '../billing/entitlement';

export interface AuthUser {
  id: string;
  email: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface JsonResponse {
  data?: unknown;
  error?: string;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    // Attach Bearer token from secure storage, auto-refreshing if expired
    const stored = await getValidAuth(API_BASE_URL);
    if (stored) {
      headers.Authorization = `Bearer ${stored.accessToken}`;
    }

    const response = await apiFetch(url, {
      ...options,
      headers,
    });

    const data = (await response.json()) as JsonResponse;

    if (!response.ok) {
      return { success: false, error: data.error ?? `HTTP ${String(response.status)}` };
    }

    return { success: true, data: (data.data ?? data) as T };
  } catch (error) {
    console.error(`[Auth] API request failed:`, error);
    return {
      success: false,
      error: formatNetworkError(error),
    };
  }
}

export function registerAuthHandlers(): void {
  console.log('[Auth] Registering auth IPC handlers');

  // Login handler
  ipcMain.handle(
    'auth:login',
    async (
      _event,
      args: { email: string; password: string }
    ): Promise<{ success: true; user: AuthUser } | { success: false; error: string }> => {
      try {
        const result = await apiRequest<{
          user: AuthUser;
          session: { accessToken: string; refreshToken: string; expiresAt: number };
        }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: args.email, password: args.password }),
        });

        if (!result.success || !result.data) {
          console.log('[Auth] Login failed:', result.error);
          return { success: false, error: result.error ?? 'Invalid credentials' };
        }

        const { user, session } = result.data;

        // Store real access token for API authentication
        storeAuth({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt * 1000, // Convert to milliseconds
          user: { id: user.id, email: user.email },
        });

        console.log('[Auth] Login successful for user:', user.email);
        return { success: true, user: { id: user.id, email: user.email } };
      } catch (err) {
        console.error('[Auth] Login error:', err);
        return { success: false, error: formatNetworkError(err) };
      }
    }
  );

  // Logout handler
  ipcMain.handle('auth:logout', async (): Promise<{ success: boolean }> => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      clearStoredAuth();
      clearPlanCache();
      console.log('[Auth] Logged out');
      return { success: true };
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      clearStoredAuth();
      clearPlanCache();
      return { success: true };
    }
  });

  // Get session handler (auto-refreshes expired tokens)
  ipcMain.handle(
    'auth:getSession',
    async (): Promise<{ user: AuthUser | null; profile: Profile | null }> => {
      const stored = await getValidAuth(API_BASE_URL);
      if (!stored) {
        return { user: null, profile: null };
      }

      return { user: stored.user, profile: null };
    }
  );

  // Validate session (check if still valid, auto-refreshing if needed)
  ipcMain.handle(
    'auth:validateSession',
    async (): Promise<{ valid: boolean; user: AuthUser | null }> => {
      const stored = getStoredAuth();
      if (!stored) {
        return { valid: false, user: null };
      }

      if (!isAuthExpired(stored)) {
        return { valid: true, user: stored.user };
      }

      // Token expired — try to refresh
      const refreshed = await getValidAuth(API_BASE_URL);
      if (refreshed) {
        return { valid: true, user: refreshed.user };
      }

      clearStoredAuth();
      return { valid: false, user: null };
    }
  );

  // Get access token for API calls (used by renderer for SSE connections)
  ipcMain.handle('auth:getToken', async (): Promise<{ token: string | null }> => {
    const stored = await getValidAuth(API_BASE_URL);
    if (!stored) {
      return { token: null };
    }
    return { token: stored.accessToken };
  });

  // Remember me: store credentials
  ipcMain.handle(
    'auth:setRememberedCredentials',
    (_event, args: { email: string; password: string }): { success: boolean } => {
      try {
        storeCredentials({ email: args.email, password: args.password });
        return { success: true };
      } catch (error) {
        console.error('[Auth] Failed to store credentials:', error);
        return { success: false };
      }
    }
  );

  // Remember me: get credentials
  ipcMain.handle(
    'auth:getRememberedCredentials',
    (): { credentials: { email: string; password: string } | null } => {
      try {
        return { credentials: getStoredCredentials() };
      } catch (error) {
        console.error('[Auth] Failed to get stored credentials:', error);
        return { credentials: null };
      }
    }
  );

  // Remember me: clear credentials
  ipcMain.handle('auth:clearRememberedCredentials', (): { success: boolean } => {
    try {
      clearStoredCredentials();
      return { success: true };
    } catch (error) {
      console.error('[Auth] Failed to clear stored credentials:', error);
      return { success: false };
    }
  });

  // Open external URL (for signup/forgot password)
  ipcMain.handle('auth:openExternal', async (_event, url: string): Promise<void> => {
    // For signup/forgot password, open the web app
    const fullUrl = url.startsWith('http') ? url : `${APP_URL}${url}`;
    await shell.openExternal(fullUrl);
  });

  console.log('[Auth] Auth IPC handlers registered');
}
