/**
 * ChatPanel — collapsible bottom-sheet chat panel for in-session messaging.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import type { ChatMessage as ChatMessageType } from '@pairux/shared-types';
import { ChatMessage } from './ChatMessage';

interface ChatPanelProps {
  messages: ChatMessageType[];
  onSend: (content: string) => Promise<void>;
  sending: boolean;
  currentUserId?: string;
  loading?: boolean;
}

export function ChatPanel({ messages, onSend, sending, currentUserId, loading }: ChatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList<ChatMessageType>>(null);
  const panelHeight = useRef(new Animated.Value(48)).current;

  useEffect(() => {
    Animated.timing(panelHeight, {
      toValue: expanded ? 320 : 48,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [expanded, panelHeight]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (expanded && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, expanded]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const content = input;
    setInput('');
    await onSend(content);
  }

  const unreadCount = expanded ? 0 : messages.length;

  return (
    <Animated.View style={{ height: panelHeight }} className="border-t border-gray-800 bg-gray-900">
      {/* Header toggle */}
      <TouchableOpacity
        onPress={() => {
          setExpanded(!expanded);
        }}
        className="flex-row items-center justify-between px-4 py-3"
      >
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-semibold text-white">Chat</Text>
          {!expanded && unreadCount > 0 && (
            <View className="rounded-full bg-primary-500 px-2 py-0.5">
              <Text className="text-xs font-bold text-white">{unreadCount}</Text>
            </View>
          )}
        </View>
        <Text className="text-gray-400">{expanded ? 'v' : '^'}</Text>
      </TouchableOpacity>

      {expanded && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          {/* Messages */}
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            className="flex-1"
            contentContainerStyle={{ paddingVertical: 4 }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-6">
                <Text className="text-sm text-gray-500">
                  {loading ? 'Loading messages...' : 'No messages yet'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <ChatMessage message={item} isOwn={item.user_id === currentUserId} />
            )}
          />

          {/* Input */}
          <View className="flex-row items-center gap-2 border-t border-gray-800 px-3 py-2">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Type a message..."
              placeholderTextColor="#6b7280"
              className="flex-1 rounded-full bg-gray-800 px-4 py-2 text-sm text-white"
              onSubmitEditing={() => {
                void handleSend();
              }}
              returnKeyType="send"
            />
            <TouchableOpacity
              onPress={() => {
                void handleSend();
              }}
              disabled={!input.trim() || sending}
              className={`rounded-full px-4 py-2 ${
                !input.trim() || sending ? 'bg-gray-700' : 'bg-primary-600'
              }`}
            >
              <Text className="text-sm font-medium text-white">Send</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </Animated.View>
  );
}
