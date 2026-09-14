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

export interface ChatSendOutcome {
  status: 'sent' | 'failed' | 'unknown' | 'cancelled' | 'ignored';
}

interface UseChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  historyReady: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<ChatSendOutcome>;
  sending: boolean;
}

export function useChat({
  sessionId,
  participantId,
  enabled = true,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollGenerationRef = useRef(0);
  const pollInFlightRef = useRef<number | null>(null);
  const sendOperationRef = useRef<symbol | null>(null);
  const mountedRef = useRef(true);
  const isMounted = useCallback(() => mountedRef.current, []);
  const previousSessionIdRef = useRef(sessionId);
  const requestsRef = useRef(new Set<AbortController>());

  // Fetch messages
  const fetchMessages = useCallback(
    async (generation: number) => {
      if (pollInFlightRef.current === generation) return;
      pollInFlightRef.current = generation;
      const controller = new AbortController();
      requestsRef.current.add(controller);

      try {
        const result = await chatApi.getHistory(sessionId, { limit: 100 }, controller.signal);
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
          setHistoryReady(true);
        }
      } catch {
        if (mountedRef.current && pollGenerationRef.current === generation) {
          setError('Failed to fetch messages');
        }
      } finally {
        requestsRef.current.delete(controller);
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
    const requests = requestsRef.current;
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
      setHistoryReady(false);
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
      for (const controller of requests) controller.abort();
      requests.clear();
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
    async (content: string): Promise<ChatSendOutcome> => {
      const trimmed = content.trim();
      if (!trimmed || sendOperationRef.current) return { status: 'ignored' };
      if (!enabled || !isMounted()) return { status: 'cancelled' };

      const generation = pollGenerationRef.current;
      const operation = Symbol('chat-send');
      sendOperationRef.current = operation;
      setSending(true);
      const controller = new AbortController();
      requestsRef.current.add(controller);

      try {
        const result = await chatApi.send(sessionId, trimmed, participantId, controller.signal);
        if (!isMounted() || pollGenerationRef.current !== generation) return { status: 'unknown' };

        if (result.error) {
          setError(result.error);
          return { status: result.failureKind === 'rejected' ? 'failed' : 'unknown' };
        }

        const msg = result.data;
        if (!msg || typeof msg.id !== 'string' || !msg.id || msg.session_id !== sessionId) {
          setError('Message delivery could not be confirmed');
          return { status: 'unknown' };
        }
        if (!seenIdsRef.current.has(msg.id)) {
          seenIdsRef.current.add(msg.id);
          setMessages((prev) => [...prev, msg]);
        }

        setError(null);
        return { status: 'sent' };
      } catch {
        if (isMounted() && pollGenerationRef.current === generation) {
          setError('Failed to send message');
        }
        return { status: 'unknown' };
      } finally {
        requestsRef.current.delete(controller);
        if (sendOperationRef.current === operation) {
          sendOperationRef.current = null;
          if (isMounted()) {
            setSending(false);
          }
        }
      }
    },
    [sessionId, participantId, enabled, isMounted]
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
    historyReady,
    error,
    sendMessage,
    sending,
  };
}
