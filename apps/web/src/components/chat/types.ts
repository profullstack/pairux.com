import type { ChatMessage, SessionParticipant } from '@pairux/shared-types';

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
  onToggleCollapse?: (() => void) | undefined;
  className?: string | undefined;
  currentUserId?: string | null | undefined;
  isHost?: boolean | undefined;
  mutedParticipants?: Set<string> | undefined;
  onGrantControl?: ((participant: SessionParticipant) => void) | undefined;
  onRevokeControl?: ((participant: SessionParticipant) => void) | undefined;
  onKickParticipant?: ((participant: SessionParticipant) => void) | undefined;
  onMuteParticipant?: ((participant: SessionParticipant, muted: boolean) => void) | undefined;
}

export interface ChatMessageProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  currentUserDisplayName?: string;
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
  participants?: SessionParticipant[];
  onTyping?: () => void;
  onStopTyping?: () => void;
}

export interface TypingUser {
  participantId: string;
  displayName: string;
}

export interface ParticipantListProps {
  participants: SessionParticipant[];
  currentUserId?: string | null;
  currentParticipantId?: string | null;
  isLoading?: boolean;
  onStartDM?: (participant: SessionParticipant) => void;
  defaultExpanded?: boolean;
  isHost?: boolean;
  mutedParticipants?: Set<string>;
  onGrantControl?: (participant: SessionParticipant) => void;
  onRevokeControl?: (participant: SessionParticipant) => void;
  onKickParticipant?: (participant: SessionParticipant) => void;
  onMuteParticipant?: (participant: SessionParticipant, muted: boolean) => void;
}

export interface ParticipantItemProps {
  participant: SessionParticipant;
  isCurrentUser: boolean;
  onStartDM?: (participant: SessionParticipant) => void;
  isHostContext?: boolean;
  isMuted?: boolean;
  onGrantControl?: (participant: SessionParticipant) => void;
  onRevokeControl?: (participant: SessionParticipant) => void;
  onKickParticipant?: (participant: SessionParticipant) => void;
  onMuteParticipant?: (participant: SessionParticipant, muted: boolean) => void;
}
