import { useState, useCallback, useRef, useEffect } from 'react';
import {
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Wifi,
  WifiOff,
  AlertCircle,
  RefreshCw,
  Send,
  Loader2,
  ChevronUp,
} from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { ParticipantList } from './ParticipantList';
import { useChat } from './useChat';
import { useParticipants } from './useParticipants';
import type { ChatMessage as ChatMessageType } from '@pairux/shared-types';

interface ChatPanelProps {
  sessionId: string;
  currentUserId?: string | null;
  participantId?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const MAX_MESSAGE_LENGTH = 500;

export function ChatPanel({
  sessionId,
  currentUserId,
  participantId,
  isCollapsed: controlledCollapsed,
  onToggleCollapse,
}: ChatPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = controlledCollapsed ?? internalCollapsed;

  const { messages, isConnected, isLoading, error, hasMore, sendMessage, loadMore, reconnect } =
    useChat({
      sessionId,
      participantId,
    });

  const { participants, isLoading: participantsLoading } = useParticipants({
    sessionId,
  });

  // Message input state
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Refs for auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  }, [onToggleCollapse]);

  // Determine if a message is from the current user
  const isOwnMessage = useCallback(
    (message: ChatMessageType) => {
      if (currentUserId && message.user_id === currentUserId) {
        return true;
      }
      return false;
    },
    [currentUserId]
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100;

      if (isNearBottom) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages]);

  // Handle send message
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    setSendError(null);

    try {
      await sendMessage(inputValue);
      setInputValue('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setIsSending(false);
    }
  }, [inputValue, isSending, sendMessage]);

  // Handle key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  if (isCollapsed) {
    return (
      <button
        onClick={handleToggle}
        className="flex h-full w-12 flex-col items-center justify-center border-l border-border bg-background hover:bg-muted"
        title="Open chat"
      >
        <MessageSquare className="h-5 w-5 text-muted-foreground" />
        <ChevronLeft className="mt-2 h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-medium">Chat</h2>
          {/* Connection status */}
          {isConnected ? (
            <Wifi className="h-4 w-4 text-green-500" aria-label="Connected" />
          ) : (
            <WifiOff className="h-4 w-4 text-destructive" aria-label="Disconnected" />
          )}
        </div>

        <button
          onClick={handleToggle}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close chat"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={reconnect}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-destructive/20"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Participant list */}
      <ParticipantList
        participants={participants}
        currentUserId={currentUserId}
        currentParticipantId={participantId}
        isLoading={participantsLoading}
      />

      {/* Message list */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        {isLoading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-sm">No messages yet</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                onClick={() => void loadMore()}
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
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

            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isOwnMessage={isOwnMessage(message)}
              />
            ))}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message input */}
      <div className="border-t border-border p-3">
        {sendError && (
          <div className="mb-2 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {sendError}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              disabled={!isConnected || isSending}
              placeholder="Type a message..."
              rows={1}
              className="block w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />

            {/* Character count */}
            {inputValue.length > MAX_MESSAGE_LENGTH * 0.8 && (
              <span
                className={`absolute bottom-2 right-2 text-xs ${
                  inputValue.length > MAX_MESSAGE_LENGTH
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {MAX_MESSAGE_LENGTH - inputValue.length}
              </span>
            )}
          </div>

          <button
            onClick={() => void handleSend()}
            disabled={
              !inputValue.trim() ||
              inputValue.length > MAX_MESSAGE_LENGTH ||
              isSending ||
              !isConnected
            }
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
