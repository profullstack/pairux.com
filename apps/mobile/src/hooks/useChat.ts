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
  const pollGenerationRef = useRef(0);
  const pollInFlightRef = useRef<number | null>(null);
  const sendOperationRef = useRef<symbol | null>(null);
  const mountedRef = useRef(true);
  const previousSessionIdRef = useRef(sessionId);

  // Fetch messages
  const fetchMessages = useCallback(
    async (generation: number) => {
      if (pollInFlightRef.current === generation) return;
      pollInFlightRef.current = generation;

      try {
        const result = await chatApi.getHistory(sessionId, { limit: 100 });
        if (!mountedRef.current || pollGenerationRef.current !== generation) return;

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
        if (mountedRef.current && pollGenerationRef.current === generation) {
          setError('Failed to fetch messages');
        }
      } finally {
        if (pollInFlightRef.current === generation) {
          pollInFlightRef.current = null;
        }
        if (mountedRef.current && pollGenerationRef.current === generation) {
          setLoading(false);
        }
      }
    },
    [sessionId]
  );

  // Start polling when enabled
  useEffect(() => {
    const generation = ++pollGenerationRef.current;
    const sessionChanged = previousSessionIdRef.current !== sessionId;
    previousSessionIdRef.current = sessionId;

    // A generation change invalidates any send started by the previous chat
    // lifecycle, including enable/disable transitions within the same session.
    if (sendOperationRef.current) {
      sendOperationRef.current = null;
      setSending(false);
    }

    if (sessionChanged) {
      seenIdsRef.current = new Set();
      setMessages([]);
      setError(null);
      setLoading(true);
    }

    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    void fetchMessages(generation);

    pollIntervalRef.current = setInterval(() => {
      void fetchMessages(generation);
    }, POLL_INTERVAL);

    return () => {
      if (pollGenerationRef.current === generation) {
        pollGenerationRef.current += 1;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, fetchMessages, sessionId]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || sendOperationRef.current) return;

      const generation = pollGenerationRef.current;
      const operation = Symbol('chat-send');
      sendOperationRef.current = operation;
      setSending(true);

      try {
        const result = await chatApi.send(sessionId, trimmed, participantId);
        if (!mountedRef.current || pollGenerationRef.current !== generation) return;

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
        if (mountedRef.current && pollGenerationRef.current === generation) {
          setError('Failed to send message');
        }
      } finally {
        if (sendOperationRef.current === operation) {
          sendOperationRef.current = null;
          if (mountedRef.current && pollGenerationRef.current === generation) {
            setSending(false);
          }
        }
      }
    },
    [sessionId, participantId]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollGenerationRef.current += 1;
      sendOperationRef.current = null;
    };
  }, []);

  return {
    messages,
    loading,
    error,
    sendMessage,
    sending,
  };
}
