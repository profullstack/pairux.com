import { ipcMain, shell } from 'electron';
import { storeAuth, getStoredAuth, clearStoredAuth, isAuthExpired } from '../auth/secure-storage';
import type { Profile } from '@pairux/shared-types';
import { APP_URL } from '../../shared/config';

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
    const url = `${APP_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };
    const response = await fetch(url, {
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
      error: error instanceof Error ? error.message : 'Network error',
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
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // Logout handler
  ipcMain.handle('auth:logout', async (): Promise<{ success: boolean }> => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      clearStoredAuth();
      console.log('[Auth] Logged out');
      return { success: true };
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      clearStoredAuth();
      return { success: true };
    }
  });

  // Get session handler
  ipcMain.handle('auth:getSession', (): { user: AuthUser | null; profile: Profile | null } => {
    const stored = getStoredAuth();
    if (!stored || isAuthExpired(stored)) {
      return { user: null, profile: null };
    }

    // Return stored user info
    // Profile would need to be fetched separately if needed
    return { user: stored.user, profile: null };
  });

  // Validate session (check if still valid)
  ipcMain.handle('auth:validateSession', (): { valid: boolean; user: AuthUser | null } => {
    const stored = getStoredAuth();
    if (!stored) {
      return { valid: false, user: null };
    }

    if (isAuthExpired(stored)) {
      clearStoredAuth();
      return { valid: false, user: null };
    }

    return { valid: true, user: stored.user };
  });

  // Open external URL (for signup/forgot password)
  ipcMain.handle('auth:openExternal', async (_event, url: string): Promise<void> => {
    // For signup/forgot password, open the web app
    const fullUrl = url.startsWith('http') ? url : `${APP_URL}${url}`;
    await shell.openExternal(fullUrl);
  });

  console.log('[Auth] Auth IPC handlers registered');
}
