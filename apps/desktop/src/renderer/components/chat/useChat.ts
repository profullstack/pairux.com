import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage } from '@pairux/shared-types';
import { getElectronAPI } from '@/lib/ipc';

interface ChatState {
  messages: ChatMessage[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
}

interface UseChatOptions {
  sessionId: string;
  participantId?: string;
  autoConnect?: boolean;
}

interface UseChatReturn extends ChatState {
  sendMessage: (content: string) => Promise<void>;
  loadMore: () => Promise<void>;
  reconnect: () => void;
  clearError: () => void;
}

// Poll interval for new messages (in ms)
const POLL_INTERVAL = 2000;

export function useChat({ sessionId, autoConnect = true }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageTimeRef = useRef<string | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());

  // Load initial chat history
  const loadHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const api = getElectronAPI();
      const result = await api.invoke('chat:getHistory', { sessionId });

      if (!result.success) {
        throw new Error(result.error);
      }

      setMessages(result.messages);
      setHasMore(result.hasMore);

      // Track message IDs for duplicate detection
      messageIdsRef.current = new Set(result.messages.map((m: ChatMessage) => m.id));

      // Track the latest message time for polling
      if (result.messages.length > 0) {
        lastMessageTimeRef.current =
          result.messages[result.messages.length - 1]?.created_at ?? null;
      }

      setIsConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat history');
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Load more messages (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || messages.length === 0) return;

    const oldestMessage = messages[0];

    try {
      const api = getElectronAPI();
      const result = await api.invoke('chat:getHistory', {
        sessionId,
        before: oldestMessage.created_at,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // Update the ref with older message IDs
      result.messages.forEach((m: ChatMessage) => messageIdsRef.current.add(m.id));
      setMessages((prev) => [...result.messages, ...prev]);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more messages');
    }
  }, [sessionId, hasMore, isLoading, messages]);

  // Poll for new messages
  const pollForNewMessages = useCallback(async () => {
    if (!lastMessageTimeRef.current) return;

    try {
      const api = getElectronAPI();
      // Get messages newer than our last known message
      const result = await api.invoke('chat:getHistory', {
        sessionId,
        limit: 50,
      });

      if (!result.success) {
        return; // Silently fail on poll errors
      }

      // Find new messages using the ref to avoid dependency on messages state
      const newMessages = result.messages.filter(
        (m: ChatMessage) => !messageIdsRef.current.has(m.id)
      );

      if (newMessages.length > 0) {
        // Update the ref with new message IDs
        newMessages.forEach((m: ChatMessage) => messageIdsRef.current.add(m.id));

        setMessages((prev) => [...prev, ...newMessages]);
        lastMessageTimeRef.current =
          newMessages[newMessages.length - 1]?.created_at ?? lastMessageTimeRef.current;
      }
    } catch {
      // Silently fail on poll errors
    }
  }, [sessionId]);

  // Start polling
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(() => {
      void pollForNewMessages();
    }, POLL_INTERVAL);
  }, [pollForNewMessages]);

  // Reconnect manually
  const reconnect = useCallback(() => {
    setError(null);
    void loadHistory().then(() => {
      startPolling();
    });
  }, [loadHistory, startPolling]);

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      try {
        const api = getElectronAPI();
        const result = await api.invoke('chat:send', {
          sessionId,
          content: content.trim(),
        });

        if (!result.success) {
          throw new Error(result.error);
        }

        // Add the message to the list
        setMessages((prev) => {
          if (prev.some((m) => m.id === result.message.id)) {
            return prev;
          }
          // Update the ref
          messageIdsRef.current.add(result.message.id);
          return [...prev, result.message];
        });

        lastMessageTimeRef.current = result.message.created_at;
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to send message');
      }
    },
    [sessionId]
  );

  // Initial load and polling
  useEffect(() => {
    void loadHistory().then(() => {
      if (autoConnect) {
        startPolling();
      }
    });

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [loadHistory, startPolling, autoConnect]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isConnected,
    isLoading,
    error,
    hasMore,
    sendMessage,
    loadMore,
    reconnect,
    clearError,
  };
}
