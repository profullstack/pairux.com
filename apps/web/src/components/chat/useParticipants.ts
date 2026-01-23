'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionParticipant, SessionWithParticipants } from '@pairux/shared-types';
import { createClient } from '@/lib/supabase/client';

interface UseParticipantsOptions {
  sessionId: string;
}

interface UseParticipantsReturn {
  participants: SessionParticipant[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export function useParticipants({ sessionId }: UseParticipantsOptions): UseParticipantsReturn {
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());

  // Fetch participants from API
  const fetchParticipants = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = (await res.json()) as ApiResponse<SessionWithParticipants>;

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to fetch participants');
      }

      if (data.data?.session_participants) {
        // Filter to only active participants (no left_at)
        const active = data.data.session_participants.filter((p) => !p.left_at);
        // Sort: host first, then by joined_at
        active.sort((a, b) => {
          if (a.role === 'host' && b.role !== 'host') return -1;
          if (b.role === 'host' && a.role !== 'host') return 1;
          return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
        });
        setParticipants(active);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch participants');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Subscribe to realtime changes
  useEffect(() => {
    void fetchParticipants();

    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`participants:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newParticipant = payload.new as SessionParticipant;
            if (!newParticipant.left_at) {
              setParticipants((prev) => {
                // Avoid duplicates
                if (prev.some((p) => p.id === newParticipant.id)) return prev;
                // Insert in correct position (host first, then by join time)
                const updated = [...prev, newParticipant];
                updated.sort((a, b) => {
                  if (a.role === 'host' && b.role !== 'host') return -1;
                  if (b.role === 'host' && a.role !== 'host') return 1;
                  return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
                });
                return updated;
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as SessionParticipant;
            setParticipants((prev) => {
              // If participant left, remove them
              if (updated.left_at) {
                return prev.filter((p) => p.id !== updated.id);
              }
              // Otherwise update their data
              return prev.map((p) => (p.id === updated.id ? updated : p));
            });
          } else {
            // DELETE event
            const deleted = payload.old as SessionParticipant;
            setParticipants((prev) => prev.filter((p) => p.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, fetchParticipants]);

  return {
    participants,
    isLoading,
    error,
    refetch: fetchParticipants,
  };
}
