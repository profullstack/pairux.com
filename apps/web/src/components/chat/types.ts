import type { ChatMessage } from '@pairux/shared-types';

export interface ChatState {
  messages: ChatMessage[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
}

export interface ChatPanelProps {
  sessionId: string;
  participantId?: string; // For guests
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export interface ChatMessageProps {
  message: ChatMessage;
  isOwnMessage: boolean;
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  currentUserId?: string | null;
  currentParticipantId?: string | null;
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export interface ChatMessageInputProps {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  maxLength?: number;
}
