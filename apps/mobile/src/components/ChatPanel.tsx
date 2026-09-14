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
import type { ChatSendOutcome } from '../hooks/useChat';

interface ChatPanelProps {
  messages: ChatMessageType[];
  onSend: (content: string) => Promise<ChatSendOutcome>;
  sending: boolean;
  currentUserId?: string;
  loading?: boolean;
  historyReady?: boolean;
  error?: string | null;
}

export function ChatPanel({
  messages,
  onSend,
  sending,
  currentUserId,
  loading,
  historyReady = false,
  error,
}: ChatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList<ChatMessageType>>(null);
  const panelHeight = useRef(new Animated.Value(48)).current;
  const inputRef = useRef('');
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const [localSending, setLocalSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const seenRef = useRef(new Set<string>());
  const initializedRef = useRef(false);

  const changeInput = (text: string) => {
    inputRef.current = text;
    setInput(text);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const fresh = messages.filter((message) => !seenRef.current.has(message.id));
    for (const message of messages) seenRef.current.add(message.id);
    if (!initializedRef.current) {
      if (historyReady && currentUserId) initializedRef.current = true;
      return;
    }
    if (expanded) setUnreadCount(0);
    else if (currentUserId)
      setUnreadCount(
        (count) => count + fresh.filter((message) => message.user_id !== currentUserId).length
      );
  }, [messages, historyReady, expanded, currentUserId]);

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
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [messages.length, expanded]);

  async function handleSend() {
    if (!inputRef.current.trim() || sending || busyRef.current || savedDraft) return;
    const content = inputRef.current;
    busyRef.current = true;
    setLocalSending(true);
    changeInput('');
    let outcome: ChatSendOutcome;
    try {
      outcome = await onSend(content);
    } catch {
      outcome = { status: 'unknown' };
    }
    if (!mountedRef.current) return;
    busyRef.current = false;
    setLocalSending(false);
    if (outcome.status === 'sent') {
      setNotice(null);
      return;
    }
    if (!inputRef.current.trim()) changeInput(content);
    else setSavedDraft(content);
    setNotice(
      outcome.status === 'unknown'
        ? 'This message may have been sent. Resending can duplicate it.'
        : 'Message not sent. Your draft has been kept.'
    );
  }

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

          {(notice ?? error) && (
            <Text accessibilityRole="alert" className="px-3 py-2 text-sm text-amber-300">
              {notice ?? 'Chat could not be updated. It will check again shortly.'}
            </Text>
          )}
          {savedDraft && (
            <View className="px-3 py-2">
              <Text className="text-sm text-amber-300">
                Sending paused: another draft is saved.
              </Text>
              <Text selectable numberOfLines={2} className="text-sm text-white">
                {savedDraft}
              </Text>
              <TouchableOpacity
                disabled={!!input.trim()}
                onPress={() => {
                  if (inputRef.current.trim()) return;
                  changeInput(savedDraft);
                  setSavedDraft(null);
                }}
                accessibilityLabel="Restore saved draft"
              >
                <Text className={`text-sm ${input.trim() ? 'text-gray-500' : 'text-primary-300'}`}>
                  Restore draft
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setSavedDraft(null);
                  setNotice(null);
                }}
                accessibilityLabel="Discard saved draft"
              >
                <Text className="text-sm text-gray-400">Discard saved draft</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Input */}
          <View className="flex-row items-center gap-2 border-t border-gray-800 px-3 py-2">
            <TextInput
              value={input}
              onChangeText={changeInput}
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
              disabled={!input.trim() || sending || localSending || !!savedDraft}
              className={`rounded-full px-4 py-2 ${
                !input.trim() || sending || localSending || savedDraft
                  ? 'bg-gray-700'
                  : 'bg-primary-600'
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
