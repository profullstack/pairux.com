'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TypingUser } from './types';

const DEBOUNCE_MS = 1000;
const AUTO_STOP_MS = 3000;

interface TypingBroadcastPayload {
  participantId: string;
  displayName: string;
  isTyping: boolean;
}

interface UseTypingIndicatorOptions {
  sessionId: string;
  participantId: string | undefined;
  displayName: string | undefined;
}

interface UseTypingIndicatorReturn {
  emitTyping: () => void;
  stopTyping: () => void;
  typingUsers: TypingUser[];
}

export function useTypingIndicator({
  sessionId,
  participantId,
  displayName,
}: UseTypingIndicatorOptions): UseTypingIndicatorReturn {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastEmitRef = useRef(0);
  const emitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingUsersRef = useRef<
    Map<string, { displayName: string; timeoutId: ReturnType<typeof setTimeout> }>
  >(new Map());

  const syncTypingUsers = useCallback(() => {
    setTypingUsers(
      Array.from(typingUsersRef.current.entries()).map(([pid, data]) => ({
        participantId: pid,
        displayName: data.displayName,
      }))
    );
  }, []);

  const sendStopTyping = useCallback(() => {
    if (!participantId || !displayName || !channelRef.current) return;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { participantId, displayName, isTyping: false } satisfies TypingBroadcastPayload,
    });
  }, [participantId, displayName]);

  const emitTyping = useCallback(() => {
    if (!participantId || !displayName || !channelRef.current) return;

    const now = Date.now();

    // Always reset the auto-stop timer
    if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current);
    emitTimeoutRef.current = setTimeout(() => {
      sendStopTyping();
    }, AUTO_STOP_MS);

    // Debounce: only send if >1s since last emit
    if (now - lastEmitRef.current < DEBOUNCE_MS) return;

    lastEmitRef.current = now;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { participantId, displayName, isTyping: true } satisfies TypingBroadcastPayload,
    });
  }, [participantId, displayName, sendStopTyping]);

  const stopTyping = useCallback(() => {
    if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current);
    lastEmitRef.current = 0;
    sendStopTyping();
  }, [sendStopTyping]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`typing:${sessionId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const {
        participantId: typerId,
        displayName: typerName,
        isTyping,
      } = payload as TypingBroadcastPayload;

      const existing = typingUsersRef.current.get(typerId);
      if (existing) clearTimeout(existing.timeoutId);

      if (isTyping) {
        const timeoutId = setTimeout(() => {
          typingUsersRef.current.delete(typerId);
          syncTypingUsers();
        }, AUTO_STOP_MS);

        typingUsersRef.current.set(typerId, { displayName: typerName, timeoutId });
      } else {
        typingUsersRef.current.delete(typerId);
      }

      syncTypingUsers();
    });

    channel.subscribe();
    channelRef.current = channel;

    const typingMap = typingUsersRef.current;
    return () => {
      typingMap.forEach((data) => {
        clearTimeout(data.timeoutId);
      });
      typingMap.clear();
      if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, syncTypingUsers]);

  return { emitTyping, stopTyping, typingUsers };
}
