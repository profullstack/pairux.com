import { ipcMain, shell } from 'electron';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  storeAuth,
  getStoredAuth,
  clearStoredAuth,
  isAuthExpired,
} from '../auth/secure-storage';
import type { Profile } from '@pairux/shared-types';

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  // Support both VITE_ and NEXT_PUBLIC_ prefixed env vars
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL;

  const supabaseAnonKey =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.'
    );
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

export interface AuthUser {
  id: string;
  email: string;
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
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: args.email,
          password: args.password,
        });

        if (error) {
          console.log('[Auth] Login failed:', error.message);
          return { success: false, error: error.message };
        }

        // Store tokens securely
        storeAuth({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600000,
          user: { id: data.user.id, email: data.user.email ?? '' },
        });

        console.log('[Auth] Login successful for user:', data.user.email);
        return { success: true, user: { id: data.user.id, email: data.user.email ?? '' } };
      } catch (err) {
        console.error('[Auth] Login error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // Logout handler
  ipcMain.handle('auth:logout', async (): Promise<{ success: boolean }> => {
    try {
      const supabase = getSupabase();
      await supabase.auth.signOut();
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
  ipcMain.handle(
    'auth:getSession',
    async (): Promise<{ user: AuthUser | null; profile: Profile | null }> => {
      const stored = getStoredAuth();
      if (!stored || isAuthExpired(stored)) {
        return { user: null, profile: null };
      }

      try {
        const supabase = getSupabase();
        // Set session from stored tokens
        await supabase.auth.setSession({
          access_token: stored.accessToken,
          refresh_token: stored.refreshToken,
        });

        // Fetch profile
        const { data: profile }: { data: Profile | null } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', stored.user.id)
          .single();

        return { user: stored.user, profile };
      } catch (error) {
        console.error('[Auth] Get session error:', error);
        return { user: null, profile: null };
      }
    }
  );

  // Validate session (check if still valid)
  ipcMain.handle(
    'auth:validateSession',
    async (): Promise<{ valid: boolean; user: AuthUser | null }> => {
      const stored = getStoredAuth();
      if (!stored) {
        return { valid: false, user: null };
      }

      if (isAuthExpired(stored)) {
        // Try to refresh
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase.auth.refreshSession({
            refresh_token: stored.refreshToken,
          });

          if (error || !data.session) {
            console.log('[Auth] Session refresh failed:', error?.message);
            clearStoredAuth();
            return { valid: false, user: null };
          }

          storeAuth({
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at
              ? data.session.expires_at * 1000
              : Date.now() + 3600000,
            user: { id: data.user.id, email: data.user.email ?? '' },
          });

          console.log('[Auth] Session refreshed for user:', data.user.email);
          return { valid: true, user: { id: data.user.id, email: data.user.email ?? '' } };
        } catch (error) {
          console.error('[Auth] Session refresh error:', error);
          clearStoredAuth();
          return { valid: false, user: null };
        }
      }

      return { valid: true, user: stored.user };
    }
  );

  // Open external URL (for signup/forgot password)
  ipcMain.handle('auth:openExternal', async (_event, url: string): Promise<void> => {
    await shell.openExternal(url);
  });

  console.log('[Auth] Auth IPC handlers registered');
}
