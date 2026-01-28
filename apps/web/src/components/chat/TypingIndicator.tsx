'use client';

import { memo } from 'react';
import type { TypingUser } from './types';

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export const TypingIndicator = memo(function TypingIndicator({
  typingUsers,
}: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const [first, second] = typingUsers;
  let text: string;
  if (typingUsers.length === 1) {
    text = `${first?.displayName ?? ''} is typing`;
  } else if (typingUsers.length === 2) {
    text = `${first?.displayName ?? ''} and ${second?.displayName ?? ''} are typing`;
  } else {
    text = `${first?.displayName ?? ''} and ${String(typingUsers.length - 1)} others are typing`;
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1 text-xs text-gray-400">
      <span className="flex gap-0.5">
        <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
      </span>
      <span>{text}...</span>
    </div>
  );
});
