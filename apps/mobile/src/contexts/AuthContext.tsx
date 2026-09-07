/**
 * Authentication context for the mobile app.
 *
 * Provides login/signup/logout actions and persists auth state
 * via expo-secure-store. Auto-restores session on mount.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  isAuthExpired,
  storeCredentials,
  getStoredCredentials,
  clearStoredCredentials,
  type StoredCredentials,
} from '@/lib/secure-storage';
import { clearAuthSession, readAuthSession, refreshAuthSession } from '@/lib/auth-session';
import { authApi } from '@/lib/api/auth';

interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  rememberMe: boolean;
  setRememberMe: (value: boolean) => void;
  getRememberedCredentials: () => Promise<StoredCredentials | null>;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (params: {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
  }) => Promise<{ error?: string; success?: boolean; needsConfirmation?: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rememberMe, setRememberMe] = useState(false);
  // Bumped when a login or logout starts so a slower restore (or an older
  // login) that resolves afterwards cannot publish stale auth state.
  const authOpSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authOpSeqRef.current += 1;
    };
  }, []);

  // Restore session from secure storage on mount
  useEffect(() => {
    const seq = authOpSeqRef.current;
    const canPublish = () => mountedRef.current && authOpSeqRef.current === seq;
    async function restore() {
      try {
        const stored = await readAuthSession();
        if (!stored) return;
        if (!isAuthExpired(stored)) {
          if (canPublish()) setUser(stored.user);
          return;
        }
        // Token expired — refresh instead of forcing a re-login
        const { auth, failure } = await refreshAuthSession();
        if (auth) {
          if (canPublish()) setUser(auth.user);
        } else if (failure === 'rejected') {
          // The server refused the refresh token; this session is dead.
          if (canPublish()) await clearAuthSession();
        } else if (failure === 'transient') {
          // Offline start or server hiccup: keep the stored session (the
          // refresh token may still be good) and retry per API request.
          if (canPublish()) setUser(stored.user);
        }
        // 'superseded'/'signed-out': a login or logout already owns the state.
      } catch {
        // Failed to read storage — stay signed out without destroying tokens.
      } finally {
        if (canPublish()) setIsLoading(false);
      }
    }
    void restore();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const seq = ++authOpSeqRef.current;
      const result = await authApi.login(email, password);
      if (result.error) {
        if (mountedRef.current && authOpSeqRef.current === seq) setIsLoading(false);
        return { error: result.error };
      }
      if (result.data) {
        // Publish only if no logout/newer login started while we awaited.
        if (mountedRef.current && authOpSeqRef.current === seq) {
          setUser(result.data.user);
          setIsLoading(false);
          if (rememberMe) {
            await storeCredentials({ email, password });
          } else {
            await clearStoredCredentials();
          }
        }
      }
      return {};
    },
    [rememberMe]
  );

  const signup = useCallback(
    async (params: {
      email: string;
      password: string;
      confirmPassword: string;
      firstName: string;
      lastName: string;
    }) => {
      const result = await authApi.signup(params);
      if (result.error) {
        return { error: result.error };
      }
      return { success: true, needsConfirmation: result.data?.needsConfirmation ?? true };
    },
    []
  );

  const getRememberedCreds = useCallback(async () => {
    return getStoredCredentials();
  }, []);

  const logout = useCallback(async () => {
    // Sign out locally first; the epoch bump inside authApi.logout ->
    // clearAuthSession invalidates in-flight refreshes/logins, and the
    // server-side revoke is fire-and-forget.
    authOpSeqRef.current += 1;
    if (mountedRef.current) {
      setUser(null);
      setIsLoading(false);
    }
    await authApi.logout();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        rememberMe,
        setRememberMe,
        getRememberedCredentials: getRememberedCreds,
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
