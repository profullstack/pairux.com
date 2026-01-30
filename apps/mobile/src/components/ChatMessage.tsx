/**
 * ChatMessage — individual message bubble.
 */
import React from 'react';
import { View, Text } from 'react-native';
import type { ChatMessage as ChatMessageType } from '@pairux/shared-types';

interface ChatMessageProps {
  message: ChatMessageType;
  isOwn: boolean;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatMessage({ message, isOwn }: ChatMessageProps) {
  return (
    <View className={`mb-2 px-3 ${isOwn ? 'items-end' : 'items-start'}`}>
      {!isOwn && <Text className="mb-0.5 text-xs text-gray-400">{message.display_name}</Text>}
      <View
        className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          isOwn ? 'rounded-br-md bg-primary-600' : 'rounded-bl-md bg-gray-700'
        }`}
      >
        <Text className="text-sm text-white">{message.content}</Text>
      </View>
      <Text className="mt-0.5 text-[10px] text-gray-500">{formatTime(message.created_at)}</Text>
    </View>
  );
}
