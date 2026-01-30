/**
 * Auth API module.
 *
 * Handles login, signup, and logout via the cloud API.
 * Stores/clears tokens in secure storage.
 */
import { API_BASE_URL } from '../../config';
import { storeAuth, clearStoredAuth, type StoredAuth } from '../secure-storage';
import { apiRequest } from '../api';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

interface SignupResponse {
  message: string;
}

export const authApi = {
  async login(email: string, password: string): Promise<{ data?: StoredAuth; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as LoginResponse & { error?: string };

      if (!response.ok) {
        return { error: data.error ?? 'Failed to sign in' };
      }

      const auth: StoredAuth = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        user: data.user,
      };

      await storeAuth(auth);
      return { data: auth };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  async signup(params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ data?: SignupResponse; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = (await response.json()) as SignupResponse & { error?: string };

      if (!response.ok) {
        return { error: data.error ?? 'Failed to sign up' };
      }

      return { data };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  async logout(): Promise<void> {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort — always clear local tokens
    }
    await clearStoredAuth();
  },

  async getSession(): Promise<{ data?: { user: { id: string; email: string } }; error?: string }> {
    return apiRequest('/api/auth/session');
  },
};
