'use client';

import { memo } from 'react';
import { User, Info } from 'lucide-react';
import type { ChatMessageProps } from './types';

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
        <Info className="h-3 w-3 text-gray-400" />
        <span className="text-xs text-gray-500">{message.content}</span>
        <span className="text-xs text-gray-400">{formatTime(message.created_at)}</span>
      </div>
    );
  }

  const avatarColor = stringToColor(message.display_name);

  return (
    <div
      className={`flex gap-3 px-4 py-2 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
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
          <span className="text-sm font-medium text-gray-700">{message.display_name}</span>
          <span className="text-xs text-gray-400">{formatTime(message.created_at)}</span>
        </div>
        <div
          className={`mt-1 rounded-lg px-3 py-2 ${
            isOwnMessage ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-900'
          }`}
        >
          <p className="text-sm break-words whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
});
