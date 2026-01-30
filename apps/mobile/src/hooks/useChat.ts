/**
 * Chat hook — polling-based real-time chat.
 *
 * Uses 2-second polling interval (matching desktop behavior).
 * Deduplicates messages by ID.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '@pairux/shared-types';
import { chatApi } from '../lib/api/chat';

const POLL_INTERVAL = 2000;

interface UseChatOptions {
  sessionId: string;
  participantId?: string;
  enabled?: boolean;
}

interface UseChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  sending: boolean;
}

export function useChat({
  sessionId,
  participantId,
  enabled = true,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const result = await chatApi.getHistory(sessionId, { limit: 100 });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.data?.messages) {
        const newMessages: ChatMessage[] = [];
        for (const msg of result.data.messages) {
          if (!seenIdsRef.current.has(msg.id)) {
            seenIdsRef.current.add(msg.id);
            newMessages.push(msg);
          }
        }

        if (newMessages.length > 0) {
          setMessages((prev) => {
            const combined = [...prev, ...newMessages];
            // Sort by timestamp ascending
            combined.sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return combined;
          });
        }

        setError(null);
      }
    } catch {
      setError('Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Start polling when enabled
  useEffect(() => {
    if (!enabled) return;

    void fetchMessages();

    pollIntervalRef.current = setInterval(() => {
      void fetchMessages();
    }, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, fetchMessages]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      setSending(true);

      try {
        const result = await chatApi.send(sessionId, content.trim(), participantId);

        if (result.error) {
          setError(result.error);
          return;
        }

        const msg = result.data;
        if (msg && !seenIdsRef.current.has(msg.id)) {
          seenIdsRef.current.add(msg.id);
          setMessages((prev) => [...prev, msg]);
        }

        setError(null);
      } catch {
        setError('Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [sessionId, participantId]
  );

  return {
    messages,
    loading,
    error,
    sendMessage,
    sending,
  };
}
