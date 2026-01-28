import { memo, useMemo } from 'react';
import { User, Info } from 'lucide-react';
import Linkify from 'linkify-react';
import type { ChatMessage as ChatMessageType } from '@pairux/shared-types';
import { getElectronAPI } from '../../lib/ipc';

interface ChatMessageProps {
  message: ChatMessageType;
  isOwnMessage: boolean;
  currentUserDisplayName?: string;
}

// Handle link clicks to open in system browser
function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  const href = event.currentTarget.href;
  if (href) {
    void getElectronAPI().invoke('auth:openExternal', href);
  }
}

const linkifyOptions = {
  className: 'text-blue-400 hover:underline cursor-pointer',
  attributes: {
    onClick: handleLinkClick,
  },
};

// Regex to match @mentions
const MENTION_REGEX = /@([^\s@]+)/g;

// Render content with styled mentions
function renderWithMentions(
  content: string,
  isOwnMessage: boolean,
  currentUserDisplayName?: string
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex
  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(content)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push(
        <Linkify key={`text-${String(lastIndex)}`} options={linkifyOptions}>
          {content.slice(lastIndex, match.index)}
        </Linkify>
      );
    }

    const mentionName = match[1];
    const isCurrentUser = currentUserDisplayName
      ? mentionName.toLowerCase() === currentUserDisplayName.toLowerCase()
      : false;

    // Add styled mention
    parts.push(
      <span
        key={`mention-${String(match.index)}`}
        className={`font-medium ${
          isOwnMessage
            ? 'rounded bg-white/20 px-1 text-primary-foreground/90'
            : isCurrentUser
              ? 'rounded bg-primary/10 px-1 text-primary'
              : 'text-primary'
        }`}
      >
        @{mentionName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(
      <Linkify key={`text-${String(lastIndex)}`} options={linkifyOptions}>
        {content.slice(lastIndex)}
      </Linkify>
    );
  }

  return parts.length > 0
    ? parts
    : [
        <Linkify key="full" options={linkifyOptions}>
          {content}
        </Linkify>,
      ];
}

// Generate a consistent color from a string
function stringToColor(str: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] ?? 'bg-gray-500';
}

// Format timestamp to readable time
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isOwnMessage,
  currentUserDisplayName,
}: ChatMessageProps) {
  const isSystem = message.message_type === 'system';

  // Check if current user is mentioned
  const isMentioned = useMemo(() => {
    if (!currentUserDisplayName) return false;
    MENTION_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MENTION_REGEX.exec(message.content)) !== null) {
      if (match[1].toLowerCase() === currentUserDisplayName.toLowerCase()) {
        return true;
      }
    }
    return false;
  }, [message.content, currentUserDisplayName]);

  if (isSystem) {
    return (
      <div className="gap-2 px-4 py-2 flex items-center justify-center">
        <Info className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          <Linkify options={linkifyOptions}>{message.content}</Linkify>
        </span>
        <span className="text-xs text-muted-foreground/60">{formatTime(message.created_at)}</span>
      </div>
    );
  }

  const avatarColor = stringToColor(message.display_name);

  return (
    <div
      className={`gap-3 px-4 py-2 flex ${isOwnMessage ? 'flex-row-reverse' : ''} ${
        isMentioned && !isOwnMessage ? 'bg-yellow-500/10' : ''
      }`}
    >
      {/* Avatar */}
      <div
        className={`h-8 w-8 flex flex-shrink-0 items-center justify-center rounded-full ${avatarColor}`}
      >
        <User className="h-4 w-4 text-white" />
      </div>

      {/* Message content */}
      <div className={`flex max-w-[75%] flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
        <div className="gap-2 flex items-baseline">
          <span className="text-sm font-medium">{message.display_name}</span>
          <span className="text-xs text-muted-foreground">{formatTime(message.created_at)}</span>
        </div>
        <div
          className={`mt-1 rounded-lg px-3 py-2 ${
            isOwnMessage ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          <p className="text-sm break-words whitespace-pre-wrap">
            {renderWithMentions(message.content, isOwnMessage, currentUserDisplayName)}
          </p>
        </div>
      </div>
    </div>
  );
});
