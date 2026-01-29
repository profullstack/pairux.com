'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface SessionPresence {
  status: string;
  currentHostId: string | null;
  hostOnline: boolean;
}

/**
 * Subscribes to real-time session presence changes.
 * Tracks whether the host is online and the current session status.
 */
export function useSessionPresence(sessionId: string): SessionPresence {
  const [presence, setPresence] = useState<SessionPresence>({
    status: 'created',
    currentHostId: null,
    hostOnline: false,
  });

  useEffect(() => {
    const supabase = createClient();

    // Initial fetch
    void supabase
      .from('sessions')
      .select('status, current_host_id')
      .eq('id', sessionId)
      .single()
      .then(({ data, error }) => {
        if (error) return;
        const sessionData = data as { status: string; current_host_id: string | null };
        setPresence({
          status: sessionData.status,
          currentHostId: sessionData.current_host_id,
          hostOnline: sessionData.current_host_id != null,
        });
      });

    // Subscribe to real-time changes on this session row
    const channel = supabase
      .channel(`session-presence-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newData = payload.new as { status: string; current_host_id: string | null };
          setPresence({
            status: newData.status,
            currentHostId: newData.current_host_id,
            hostOnline: newData.current_host_id != null,
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return presence;
}
