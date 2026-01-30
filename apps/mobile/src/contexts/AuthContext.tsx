/**
 * Authentication context for the mobile app.
 *
 * Provides login/signup/logout actions and persists auth state
 * via expo-secure-store. Auto-restores session on mount.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getStoredAuth, isAuthExpired, clearStoredAuth } from '@/lib/secure-storage';
import { authApi } from '@/lib/api/auth';

interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<{ error?: string; success?: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from secure storage on mount
  useEffect(() => {
    async function restore() {
      try {
        const stored = await getStoredAuth();
        if (stored && !isAuthExpired(stored)) {
          setUser(stored.user);
        } else if (stored) {
          // Token expired — clear it
          await clearStoredAuth();
        }
      } catch {
        // Failed to read storage
      } finally {
        setIsLoading(false);
      }
    }
    void restore();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    if (result.error) {
      return { error: result.error };
    }
    if (result.data) {
      setUser(result.data.user);
    }
    return {};
  }, []);

  const signup = useCallback(
    async (params: { email: string; password: string; firstName: string; lastName: string }) => {
      const result = await authApi.signup(params);
      if (result.error) {
        return { error: result.error };
      }
      return { success: true };
    },
    []
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
