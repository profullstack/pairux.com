/**
 * Auth API module.
 *
 * Handles login, signup, and logout via the cloud API.
 * Stores/clears tokens in secure storage.
 *
 * The server wraps every success payload as `{ data: ... }`
 * (apps/web/src/lib/api.ts successResponse) and returns Supabase's
 * `expires_at` in SECONDS; storage keeps milliseconds.
 */
import { API_BASE_URL } from '../../config';
import type { StoredAuth } from '../secure-storage';
import {
  beginAuthMutation,
  endAuthSession,
  commitLoginSession,
  parseSessionEnvelope,
} from '../auth-session';
import { apiRequest } from '../api';

interface LoginResponse {
  data?: {
    user: { id: string; email: string };
    session: { accessToken: string; refreshToken: string; expiresAt: number };
  };
  error?: string;
}

interface SignupResponse {
  data?: {
    user?: { id: string; email?: string };
    message: string;
    needsConfirmation: boolean;
  };
  error?: string;
}

export const authApi = {
  async login(email: string, password: string): Promise<{ data?: StoredAuth; error?: string }> {
    // A newer login intent or logout invalidates this attempt, even before
    // the newer network request has completed.
    const startedEpoch = beginAuthMutation();
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as LoginResponse;

      if (!response.ok) {
        return { error: data.error ?? 'Failed to sign in' };
      }

      // Defensive: the fields are non-optional in the type, but an OK
      // response from a proxy or an older server may not carry them —
      // and empty/NaN token fields must never reach secure storage.
      const payload = data.data as Partial<NonNullable<LoginResponse['data']>> | undefined;
      const session = parseSessionEnvelope(payload?.session);
      const user = payload?.user as Partial<{ id: string; email: string }> | undefined;
      if (!session || typeof user?.id !== 'string' || user.id.length === 0) {
        return { error: 'Invalid response from server' };
      }

      const auth: StoredAuth = {
        ...session,
        user: { id: user.id, email: typeof user.email === 'string' ? user.email : email },
      };

      const committed = await commitLoginSession(auth, startedEpoch);
      if (!committed) {
        return { error: 'Sign-in was interrupted. Please try again.' };
      }
      return { data: auth };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  async signup(params: {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
  }): Promise<{ data?: { message: string; needsConfirmation: boolean }; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = (await response.json()) as SignupResponse;

      if (!response.ok) {
        return { error: data.error ?? 'Failed to sign up' };
      }

      if (!data.data) {
        return { error: 'Invalid response from server' };
      }

      return {
        data: {
          message: data.data.message,
          needsConfirmation: data.data.needsConfirmation,
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  async logout(): Promise<void> {
    // Capture the current token as-is for the best-effort server-side
    // revoke. Never refresh here: signing out must not mint new tokens,
    // and local logout must complete even when the network stalls.
    const previous = await endAuthSession();
    const token = previous?.accessToken;

    if (token) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, 10000);
      void fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
        .catch(() => {
          // Best-effort revoke; the local session is already gone.
        })
        .finally(() => {
          clearTimeout(timer);
        });
    }
  },

  async getSession(): Promise<{ data?: { user: { id: string; email: string } }; error?: string }> {
    return apiRequest('/api/auth/session');
  },
};
