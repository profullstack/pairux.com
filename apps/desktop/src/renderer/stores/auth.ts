import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getElectronAPI } from '@/lib/ipc';
import type { Profile } from '@pairux/shared-types';
import type { AuthUser } from '../../preload/api';

interface AuthState {
  user: AuthUser | null;
  profile: Profile | null;
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  setProfile: (profile: Profile | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      isLoading: false,
      isInitialized: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const api = getElectronAPI();
          const result = await api.invoke('auth:login', { email, password });

          if (result.success) {
            set({ user: result.user, isLoading: false });
            // Fetch profile after login
            const session = await api.invoke('auth:getSession', undefined);
            if (session.profile) {
              set({ profile: session.profile });
            }
            return true;
          } else {
            set({ isLoading: false });
            return false;
          }
        } catch (error) {
          console.error('Login error:', error);
          set({ isLoading: false });
          return false;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          const api = getElectronAPI();
          await api.invoke('auth:logout', undefined);
        } finally {
          set({ user: null, profile: null, isLoading: false });
        }
      },

      checkSession: async () => {
        if (get().isInitialized) return;

        set({ isLoading: true });
        try {
          const api = getElectronAPI();
          const result = await api.invoke('auth:validateSession', undefined);

          if (result.valid && result.user) {
            set({ user: result.user });
            // Also fetch profile
            const session = await api.invoke('auth:getSession', undefined);
            if (session.profile) {
              set({ profile: session.profile });
            }
          } else {
            set({ user: null, profile: null });
          }
        } catch (error) {
          console.error('Session check error:', error);
          set({ user: null, profile: null });
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      },

      setUser: (user) => { set({ user }); },
      setProfile: (profile) => { set({ profile }); },
    }),
    {
      name: 'pairux-auth',
      storage: createJSONStorage(() => localStorage),
      // Only persist minimal user info (tokens are in secure storage)
      partialize: (state) => ({
        user: state.user ? { id: state.user.id, email: state.user.email } : null,
      }),
    }
  )
);
