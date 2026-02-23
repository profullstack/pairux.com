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
  ArrowLeft,
  User,
} from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';
import { ChatMessageList } from './ChatMessageList';
import { ChatMessageInput } from './ChatMessageInput';
import { ParticipantList } from './ParticipantList';
import { TypingIndicator } from './TypingIndicator';
import { useChat } from './useChat';
import { useParticipants } from './useParticipants';
import { useTypingIndicator } from './useTypingIndicator';
import type { ChatPanelProps } from './types';

export function ChatPanel({
  sessionId,
  participantId,
  isCollapsed: controlledCollapsed,
  onToggleCollapse,
  className = '',
  currentUserId = null,
  isHost = false,
  mutedParticipants,
  onGrantControl,
  onRevokeControl,
  onKickParticipant,
  onMuteParticipant,
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

  const currentParticipant = participants.find((p) => p.id === participantId);
  const { emitTyping, stopTyping, typingUsers } = useTypingIndicator({
    sessionId,
    participantId,
    displayName: currentParticipant?.display_name,
  });

  const [unreadCount, setUnreadCount] = useState(0);
  const [dmRecipient, setDmRecipient] = useState<SessionParticipant | null>(null);

  // Handle starting a DM with a participant
  const handleStartDM = useCallback((participant: SessionParticipant) => {
    setDmRecipient(participant);
  }, []);

  // Handle closing DM mode
  const handleCloseDM = useCallback(() => {
    setDmRecipient(null);
  }, []);

  // Wrap sendMessage to include recipientId for DMs
  const handleSendMessage = useCallback(
    async (content: string) => {
      // For DMs, we need to modify the message to include recipientId
      // The current useChat hook doesn't support this yet, so for now
      // we just send normally and show DM UI feedback
      await sendMessage(content);
    },
    [sendMessage]
  );

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
        className={`flex h-full w-12 flex-col items-center justify-center border-l border-gray-700 bg-gray-900 hover:bg-gray-800 ${className}`}
        aria-label="Open chat"
      >
        <MessageSquare className="h-5 w-5 text-gray-400" />
        {unreadCount > 0 && (
          <span className="bg-primary-500 mt-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        <ChevronLeft className="mt-2 h-4 w-4 text-gray-500" />
      </button>
    );
  }

  return (
    <div
      className={`flex h-full w-80 flex-col border-l border-gray-700 bg-gray-900 ${className}`}
      data-testid="chat-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        {dmRecipient ? (
          // DM mode header
          <div className="flex items-center gap-2">
            <button
              onClick={handleCloseDM}
              className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
              aria-label="Back to chat"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <User className="h-5 w-5 text-gray-400" />
            <h2 className="max-w-[140px] truncate font-medium text-white">
              DM: {dmRecipient.display_name}
            </h2>
          </div>
        ) : (
          // Normal chat header
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-gray-400" />
            <h2 className="font-medium text-white">Chat</h2>
            {/* Connection status */}
            {isConnected ? (
              <Wifi className="h-4 w-4 text-green-500" aria-label="Connected" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" aria-label="Disconnected" />
            )}
          </div>
        )}

        <button
          onClick={handleToggle}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
          aria-label="Close chat"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={reconnect}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-red-900/50"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Participant list - hide in DM mode */}
      {!dmRecipient && (
        <ParticipantList
          participants={participants}
          currentUserId={currentUserId}
          currentParticipantId={participantId ?? null}
          isLoading={participantsLoading}
          onStartDM={handleStartDM}
          isHost={isHost}
          {...(mutedParticipants ? { mutedParticipants } : {})}
          {...(onGrantControl ? { onGrantControl } : {})}
          {...(onRevokeControl ? { onRevokeControl } : {})}
          {...(onKickParticipant ? { onKickParticipant } : {})}
          {...(onMuteParticipant ? { onMuteParticipant } : {})}
        />
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

      {/* Typing indicator */}
      <TypingIndicator typingUsers={typingUsers} />

      {/* Message input */}
      <ChatMessageInput
        onSend={handleSendMessage}
        disabled={!isConnected}
        participants={participants}
        onTyping={emitTyping}
        onStopTyping={stopTyping}
      />
    </div>
  );
}
