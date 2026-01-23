'use client';

import { useState, useCallback } from 'react';
import {
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Wifi,
  WifiOff,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { ChatMessageList } from './ChatMessageList';
import { ChatMessageInput } from './ChatMessageInput';
import { useChat } from './useChat';
import type { ChatPanelProps } from './types';

export function ChatPanel({
  sessionId,
  participantId,
  isCollapsed: controlledCollapsed,
  onToggleCollapse,
  className = '',
}: ChatPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed ?? internalCollapsed;

  const { messages, isConnected, isLoading, error, hasMore, sendMessage, loadMore, reconnect } =
    useChat({
      sessionId,
      participantId,
    });

  const [unreadCount, setUnreadCount] = useState(0);

  const handleToggle = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
    // Reset unread count when opening
    if (isCollapsed) {
      setUnreadCount(0);
    }
  }, [isCollapsed, onToggleCollapse]);

  // Track unread messages when collapsed
  // Note: In a full implementation, we'd use useEffect to listen for new messages

  if (isCollapsed) {
    return (
      <button
        onClick={handleToggle}
        className={`flex h-full w-12 flex-col items-center justify-center border-l border-gray-200 bg-white hover:bg-gray-50 ${className}`}
        aria-label="Open chat"
      >
        <MessageSquare className="h-5 w-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="bg-primary-500 mt-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        <ChevronLeft className="mt-2 h-4 w-4 text-gray-400" />
      </button>
    );
  }

  return (
    <div
      className={`flex h-full w-80 flex-col border-l border-gray-200 bg-white ${className}`}
      data-testid="chat-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gray-600" />
          <h2 className="font-medium text-gray-900">Chat</h2>
          {/* Connection status */}
          {isConnected ? (
            <Wifi className="h-4 w-4 text-green-500" aria-label="Connected" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-500" aria-label="Disconnected" />
          )}
        </div>

        <button
          onClick={handleToggle}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close chat"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={reconnect}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-red-100"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Message list */}
      <ChatMessageList
        messages={messages}
        currentUserId={null} // Would come from auth context in real usage
        currentParticipantId={participantId ?? null}
        isLoading={isLoading}
        hasMore={hasMore}
        onLoadMore={() => {
          void loadMore();
        }}
      />

      {/* Message input */}
      <ChatMessageInput onSend={sendMessage} disabled={!isConnected} />
    </div>
  );
}
