import { memo } from 'react';
import { User, Info } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '@pairux/shared-types';

interface ChatMessageProps {
  message: ChatMessageType;
  isOwnMessage: boolean;
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

export const ChatMessage = memo(function ChatMessage({ message, isOwnMessage }: ChatMessageProps) {
  const isSystem = message.message_type === 'system';

  if (isSystem) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-2">
        <Info className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{message.content}</span>
        <span className="text-xs text-muted-foreground/60">{formatTime(message.created_at)}</span>
      </div>
    );
  }

  const avatarColor = stringToColor(message.display_name);

  return (
    <div className={`flex gap-3 px-4 py-2 ${isOwnMessage ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${avatarColor}`}
      >
        <User className="h-4 w-4 text-white" />
      </div>

      {/* Message content */}
      <div className={`flex max-w-[75%] flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{message.display_name}</span>
          <span className="text-xs text-muted-foreground">{formatTime(message.created_at)}</span>
        </div>
        <div
          className={`mt-1 rounded-lg px-3 py-2 ${
            isOwnMessage ? 'bg-primary text-primary-foreground' : 'bg-muted'
          }`}
        >
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        </div>
      </div>
    </div>
  );
});
