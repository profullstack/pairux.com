'use client';

import { memo, useMemo } from 'react';
import { User, Info } from 'lucide-react';
import Linkify from 'linkify-react';
import type { ChatMessageProps } from './types';

const linkifyOptions = {
  target: '_blank',
  rel: 'noopener noreferrer',
  className: 'text-blue-400 hover:underline',
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
      ? mentionName?.toLowerCase() === currentUserDisplayName.toLowerCase()
      : false;

    // Add styled mention
    parts.push(
      <span
        key={`mention-${String(match.index)}`}
        className={`font-medium ${
          isOwnMessage
            ? 'rounded bg-white/20 px-1 text-white/90'
            : isCurrentUser
              ? 'text-primary-400 bg-primary-900/50 rounded px-1'
              : 'text-primary-600'
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
      if (match[1]?.toLowerCase() === currentUserDisplayName.toLowerCase()) {
        return true;
      }
    }
    return false;
  }, [message.content, currentUserDisplayName]);

  if (isSystem) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-2">
        <Info className="h-3 w-3 text-gray-400" />
        <span className="text-xs text-gray-400">
          <Linkify options={linkifyOptions}>{message.content}</Linkify>
        </span>
        <span className="text-xs text-gray-500">{formatTime(message.created_at)}</span>
      </div>
    );
  }

  const avatarColor = stringToColor(message.display_name);

  return (
    <div
      className={`flex gap-3 px-4 py-2 ${isOwnMessage ? 'flex-row-reverse' : ''} ${
        isMentioned && !isOwnMessage ? 'bg-yellow-900/20' : ''
      }`}
      data-testid="chat-message"
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${avatarColor}`}
      >
        <User className="h-4 w-4 text-white" />
      </div>

      {/* Message content */}
      <div className={`flex max-w-[75%] flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-300">{message.display_name}</span>
          <span className="text-xs text-gray-500">{formatTime(message.created_at)}</span>
        </div>
        <div
          className={`mt-1 rounded-lg px-3 py-2 ${
            isOwnMessage ? 'bg-primary-500 text-white' : 'bg-gray-800 text-gray-100'
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
