import { ipcMain } from 'electron';
import { getStoredAuth, isAuthExpired } from '../auth/secure-storage';
import type { Session, SessionParticipant } from '@pairux/shared-types';
import type { CreateSessionSettings } from '../../preload/api';

const API_BASE_URL = process.env.VITE_API_URL ?? process.env.API_URL ?? 'https://pairux.com';

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

interface SessionWithParticipants extends Session {
  session_participants?: SessionParticipant[];
}

function getAuthHeaders(): Record<string, string> | null {
  const stored = getStoredAuth();
  if (!stored || isAuthExpired(stored)) {
    return null;
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${stored.accessToken}`,
  };
}

export function registerSessionHandlers(): void {
  console.log('[Session] Registering session IPC handlers');

  // Create session
  ipcMain.handle(
    'session:create',
    async (
      _event,
      settings?: CreateSessionSettings
    ): Promise<{ success: true; session: Session } | { success: false; error: string }> => {
      try {
        const headers = getAuthHeaders();
        if (!headers) {
          return { success: false, error: 'Not authenticated' };
        }

        const response = await fetch(`${API_BASE_URL}/api/sessions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            allowGuestControl: settings?.allowGuestControl ?? false,
            maxParticipants: settings?.maxParticipants ?? 5,
          }),
        });

        const data = (await response.json()) as ApiResponse<Session>;

        if (!response.ok) {
          console.error('[Session] Create session error:', data);
          return { success: false, error: data.error ?? 'Failed to create session' };
        }

        if (!data.data) {
          return { success: false, error: 'Invalid response from server' };
        }

        console.log('[Session] Session created:', data.data.id);
        return { success: true, session: data.data };
      } catch (err) {
        console.error('[Session] Create session error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // End session
  ipcMain.handle(
    'session:end',
    async (
      _event,
      args: { sessionId: string }
    ): Promise<{ success: true } | { success: false; error: string }> => {
      try {
        const headers = getAuthHeaders();
        if (!headers) {
          return { success: false, error: 'Not authenticated' };
        }

        const response = await fetch(`${API_BASE_URL}/api/sessions/${args.sessionId}`, {
          method: 'DELETE',
          headers,
        });

        if (!response.ok) {
          const data = (await response.json()) as ApiResponse<unknown>;
          console.error('[Session] End session error:', data);
          return { success: false, error: data.error ?? 'Failed to end session' };
        }

        console.log('[Session] Session ended:', args.sessionId);
        return { success: true };
      } catch (err) {
        console.error('[Session] End session error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  // Get session with participants
  ipcMain.handle(
    'session:get',
    async (
      _event,
      args: { sessionId: string }
    ): Promise<
      | { success: true; session: Session; participants: SessionParticipant[] }
      | { success: false; error: string }
    > => {
      try {
        const headers = getAuthHeaders();
        if (!headers) {
          return { success: false, error: 'Not authenticated' };
        }

        const response = await fetch(`${API_BASE_URL}/api/sessions/${args.sessionId}`, {
          method: 'GET',
          headers,
        });

        const data = (await response.json()) as ApiResponse<SessionWithParticipants>;

        if (!response.ok) {
          console.error('[Session] Get session error:', data);
          return { success: false, error: data.error ?? 'Failed to get session' };
        }

        if (!data.data) {
          return { success: false, error: 'Invalid response from server' };
        }

        const { session_participants, ...session } = data.data;
        return {
          success: true,
          session,
          participants: session_participants ?? [],
        };
      } catch (err) {
        console.error('[Session] Get session error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  console.log('[Session] Session IPC handlers registered');
}
