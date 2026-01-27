'use client';

import { useRef, useEffect, useCallback } from 'react';
import { Loader2, ChevronUp } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessageListProps } from './types';

export function ChatMessageList({
  messages,
  currentUserId,
  currentParticipantId: _currentParticipantId,
  isLoading = false,
  hasMore = false,
  onLoadMore,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const lastMessageCountRef = useRef(0);

  // Determine if a message is from the current user
  const isOwnMessage = useCallback(
    (message: { user_id: string | null; display_name: string }) => {
      if (currentUserId && message.user_id === currentUserId) {
        return true;
      }
      // For guests, we can't reliably determine ownership without participant tracking
      // This would require storing the participant's display name on the client
      return false;
    },
    [currentUserId]
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = containerRef.current;
    const bottom = bottomRef.current;

    if (!container || !bottom) return;

    // On initial load, scroll to bottom
    if (isInitialLoadRef.current && messages.length > 0) {
      // Check if scrollIntoView exists (may not in test environment)
      if (typeof bottom.scrollIntoView === 'function') {
        bottom.scrollIntoView();
      }
      isInitialLoadRef.current = false;
      lastMessageCountRef.current = messages.length;
      return;
    }

    // If we added messages at the end, scroll to bottom
    if (messages.length > lastMessageCountRef.current) {
      const isScrolledNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;

      if (isScrolledNearBottom && typeof bottom.scrollIntoView === 'function') {
        bottom.scrollIntoView({ behavior: 'smooth' });
      }
    }

    lastMessageCountRef.current = messages.length;
  }, [messages]);

  // Handle scroll for loading more messages
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || !hasMore || isLoading || !onLoadMore) return;

    // Load more when scrolled to top
    if (container.scrollTop < 50) {
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <p className="text-sm">No messages yet. Start the conversation!</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto"
      onScroll={handleScroll}
      data-testid="chat-message-list"
    >
      {/* Load more indicator */}
      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 py-2 text-sm text-gray-400 hover:text-gray-300 disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ChevronUp className="h-4 w-4" />
              Load older messages
            </>
          )}
        </button>
      )}

      {/* Message list */}
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} isOwnMessage={isOwnMessage(message)} />
      ))}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
