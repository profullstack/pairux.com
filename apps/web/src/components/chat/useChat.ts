'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage } from '@pairux/shared-types';
import type { ChatState } from './types';

interface UseChatOptions {
  sessionId: string;
  participantId?: string | undefined;
  autoConnect?: boolean;
}

interface UseChatReturn extends ChatState {
  sendMessage: (content: string) => Promise<void>;
  loadMore: () => Promise<void>;
  reconnect: () => void;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

interface ChatHistoryData {
  messages: ChatMessage[];
  hasMore: boolean;
}

export function useChat({
  sessionId,
  participantId,
  autoConnect = true,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Load initial chat history
  const loadHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(`/api/chat/history?sessionId=${sessionId}`);
      const data = (await res.json()) as ApiResponse<ChatHistoryData>;

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to load chat history');
      }

      if (data.data) {
        setMessages(data.data.messages);
        setHasMore(data.data.hasMore);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat history');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Load more messages (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || messages.length === 0) return;

    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    try {
      const res = await fetch(
        `/api/chat/history?sessionId=${sessionId}&before=${oldestMessage.created_at}`
      );
      const data = (await res.json()) as ApiResponse<ChatHistoryData>;

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to load more messages');
      }

      if (data.data) {
        const historyData = data.data;
        setMessages((prev) => [...historyData.messages, ...prev]);
        setHasMore(historyData.hasMore);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more messages');
    }
  }, [sessionId, hasMore, isLoading, messages]);

  // Connect to SSE stream
  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/chat/stream?sessionId=${sessionId}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', () => {
      setIsConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
    });

    eventSource.addEventListener('subscribed', () => {
      // Subscription confirmed
    });

    eventSource.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string) as ChatMessage;
        setMessages((prev) => {
          // Avoid duplicates
          if (prev.some((m) => m.id === message.id)) {
            return prev;
          }
          return [...prev, message];
        });
      } catch {
        console.error('Failed to parse message:', event.data);
      }
    });

    eventSource.addEventListener('heartbeat', () => {
      // Connection is alive
    });

    eventSource.addEventListener('error', () => {
      setIsConnected(false);

      // Attempt to reconnect with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      reconnectAttemptsRef.current++;

      if (reconnectAttemptsRef.current <= 5) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        setError('Connection lost. Please refresh the page.');
      }
    });

    eventSource.onerror = () => {
      eventSource.close();
    };
  }, [sessionId]);

  // Reconnect manually
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setError(null);
    connect();
  }, [connect]);

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            content: content.trim(),
            participantId,
          }),
        });

        const data = (await res.json()) as ApiResponse<ChatMessage>;

        if (!res.ok) {
          throw new Error(data.error ?? 'Failed to send message');
        }

        // Message will be added via SSE, but add optimistically for UX
        if (data.data) {
          const newMessage = data.data;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to send message');
      }
    },
    [sessionId, participantId]
  );

  // Initial load and SSE connection
  useEffect(() => {
    void loadHistory();

    if (autoConnect) {
      connect();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [loadHistory, connect, autoConnect]);

  return {
    messages,
    isConnected,
    isLoading,
    error,
    hasMore,
    sendMessage,
    loadMore,
    reconnect,
  };
}
