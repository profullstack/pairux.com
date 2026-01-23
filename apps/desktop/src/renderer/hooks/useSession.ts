import { useState, useCallback } from 'react';
import type { Session, SessionParticipant } from '@pairux/shared-types';
import { getElectronAPI } from '@/lib/ipc';

interface SessionState {
  session: Session | null;
  participants: SessionParticipant[];
  isCreating: boolean;
  isEnding: boolean;
  error: string | null;
}

interface UseSessionReturn extends SessionState {
  createSession: (settings?: {
    allowGuestControl?: boolean;
    maxParticipants?: number;
  }) => Promise<Session | null>;
  endSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
  clearError: () => void;
  setSession: (session: Session | null) => void;
}

export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSession = useCallback(
    async (settings?: { allowGuestControl?: boolean; maxParticipants?: number }) => {
      setIsCreating(true);
      setError(null);

      try {
        const api = getElectronAPI();
        const result = await api.invoke('session:create', settings);

        if (!result.success) {
          throw new Error(result.error);
        }

        setSession(result.session);
        return result.session;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create session';
        setError(message);
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

  const endSession = useCallback(async () => {
    if (!session) return;

    setIsEnding(true);
    setError(null);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:end', { sessionId: session.id });

      if (!result.success) {
        throw new Error(result.error);
      }

      setSession(null);
      setParticipants([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to end session';
      setError(message);
    } finally {
      setIsEnding(false);
    }
  }, [session]);

  const refreshSession = useCallback(async () => {
    if (!session) return;

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:get', { sessionId: session.id });

      if (!result.success) {
        throw new Error(result.error);
      }

      setSession(result.session);
      setParticipants(result.participants);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh session';
      setError(message);
    }
  }, [session]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    session,
    participants,
    isCreating,
    isEnding,
    error,
    createSession,
    endSession,
    refreshSession,
    clearError,
    setSession,
  };
}
