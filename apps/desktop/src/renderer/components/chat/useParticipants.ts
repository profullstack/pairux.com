import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionParticipant } from '@pairux/shared-types';
import { getElectronAPI } from '@/lib/ipc';

interface UseParticipantsOptions {
  sessionId: string;
}

interface UseParticipantsReturn {
  participants: SessionParticipant[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function isActiveParticipant(participant: SessionParticipant): boolean {
  return !participant.left_at;
}

function sortParticipants(participants: SessionParticipant[]): SessionParticipant[] {
  participants.sort((a, b) => {
    if (a.role === 'host' && b.role !== 'host') return -1;
    if (b.role === 'host' && a.role !== 'host') return 1;
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });
  return participants;
}

// Poll interval for participant updates (in ms)
const POLL_INTERVAL = 5000;

export function useParticipants({ sessionId }: UseParticipantsOptions): UseParticipantsReturn {
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch participants from IPC
  const fetchParticipants = useCallback(async () => {
    try {
      setError(null);
      const api = getElectronAPI();
      const result = await api.invoke('session:get', { sessionId });

      if (!result.success) {
        throw new Error(result.error);
      }

      setParticipants(sortParticipants(result.participants.filter(isActiveParticipant)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch participants');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Start polling for participant updates
  useEffect(() => {
    void fetchParticipants();

    pollIntervalRef.current = setInterval(() => {
      void fetchParticipants();
    }, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchParticipants]);

  return {
    participants,
    isLoading,
    error,
    refetch: fetchParticipants,
  };
}
