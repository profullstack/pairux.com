import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage as Message } from '@pairux/shared-types';
import { useChat } from '../hooks/useChat';
import { chatApi } from '../lib/api/chat';
vi.mock('../lib/api/chat');

// DOM adapters expose native callbacks; the actual panel logic is rendered.
vi.mock('react-native', async () => {
  const R = await import('react');
  const view = ({ children }: { children?: React.ReactNode }) =>
    R.createElement('div', {}, children);
  return {
    View: view,
    Text: ({ children }: { children?: React.ReactNode }) => R.createElement('span', {}, children),
    KeyboardAvoidingView: view,
    Platform: { OS: 'ios' },
    TouchableOpacity: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) =>
      R.createElement(
        'button',
        { onClick: onPress, disabled, 'aria-label': accessibilityLabel },
        children
      ),
    TextInput: ({
      value,
      onChangeText,
      placeholder,
    }: {
      value: string;
      onChangeText: (text: string) => void;
      placeholder: string;
    }) =>
      R.createElement('input', {
        value,
        placeholder,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChangeText(e.target.value),
      }),
    FlatList: R.forwardRef(
      (
        {
          data,
          renderItem,
          ListEmptyComponent,
        }: {
          data: Message[];
          renderItem: (args: { item: Message }) => React.ReactNode;
          ListEmptyComponent?: React.ReactNode;
        },
        ref
      ) => {
        R.useImperativeHandle(ref, () => ({ scrollToEnd() {} }));
        return R.createElement(
          'div',
          {},
          data.length
            ? data.map((item) =>
                R.createElement(R.Fragment, { key: item.id }, renderItem({ item }))
              )
            : ListEmptyComponent
        );
      }
    ),
    Animated: {
      View: view,
      Value: class {
        setValue() {}
      },
      timing: () => ({ start() {}, stop() {} }),
    },
  };
});
vi.mock('./ChatMessage', () => ({
  ChatMessage: ({ message }: { message: Message }) => <span>{message.content}</span>,
}));
const message = (id: string, user = 'other'): Message => ({
  id,
  session_id: 'room',
  user_id: user,
  display_name: 'Example',
  content: id,
  message_type: 'text',
  created_at: '2026-09-14T00:00:00Z',
  recipient_id: null,
});
const input = () => screen.getByPlaceholderText<HTMLInputElement>('Type a message...');
const open = () => fireEvent.click(screen.getByText('Chat'));

describe('chat draft recovery', () => {
  it.each(['cancelled', 'ignored'])(
    'restores a draft when send is %s before transport',
    async (status) => {
      const onSend = vi.fn().mockResolvedValue({ status });
      render(<ChatPanel messages={[]} onSend={onSend} sending={false} />);
      open();
      fireEvent.change(input(), { target: { value: 'unsent text' } });
      fireEvent.click(screen.getByText('Send'));
      await waitFor(() => expect(input().value).toBe('unsent text'));
      expect(screen.getByText(/Message not sent/)).toBeDefined();
    }
  );
  it('keeps a draft after the server rejects a message', async () => {
    const onSend = vi.fn().mockResolvedValue({ status: 'failed' });
    render(<ChatPanel messages={[]} onSend={onSend} sending={false} />);
    open();
    fireEvent.change(input(), { target: { value: 'keep my text' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(input().value).toBe('keep my text'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('keeps delivery uncertainty visible after a timeout and never auto-resends', async () => {
    const onSend = vi.fn().mockResolvedValue({ status: 'unknown' });
    render(<ChatPanel messages={[]} onSend={onSend} sending={false} />);
    open();
    fireEvent.change(input(), { target: { value: 'maybe sent' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText(/may have been sent/i)).toBeDefined());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite newer typing with the failed previous message', async () => {
    let resolve!: (result: { status: 'failed' }) => void;
    const onSend = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<ChatPanel messages={[]} onSend={onSend} sending={false} />);
    open();
    fireEvent.change(input(), { target: { value: 'old draft' } });
    fireEvent.click(screen.getByText('Send'));
    fireEvent.change(input(), { target: { value: 'new draft' } });
    await act(async () => {
      resolve({ status: 'failed' });
    });
    expect(input().value).toBe('new draft');
    expect(screen.getByText(/old draft/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Restore saved draft').hasAttribute('disabled')).toBe(true);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Restore saved draft'));
    expect(input().value).toBe('old draft');
    expect(screen.queryByLabelText('Restore saved draft')).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('guards rapid double sends even before the parent rerenders', async () => {
    const onSend = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ChatPanel messages={[]} onSend={onSend} sending={false} />);
    open();
    fireEvent.change(input(), { target: { value: 'first' } });
    fireEvent.click(screen.getByText('Send'));
    fireEvent.change(input(), { target: { value: 'second' } });
    fireEvent.click(screen.getByText('Send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not count initial history, own messages, or messages read while open', () => {
    const props = {
      onSend: vi.fn(),
      sending: false,
      currentUserId: 'me',
      loading: false,
      historyReady: true,
    };
    const { rerender } = render(<ChatPanel {...props} messages={[message('history')]} />);
    expect(screen.queryByText('1')).toBeNull();
    rerender(<ChatPanel {...props} messages={[message('history'), message('new')]} />);
    expect(screen.getByText('1')).toBeDefined();
    rerender(
      <ChatPanel {...props} messages={[message('history'), message('new'), message('own', 'me')]} />
    );
    expect(screen.getByText('1')).toBeDefined();
    open();
    open();
    expect(screen.queryByText('3')).toBeNull();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('baselines the first successful history after a failed attempt, not as unread', () => {
    const props = { onSend: vi.fn(), sending: false, currentUserId: 'me', loading: false };
    const { rerender } = render(
      <ChatPanel {...props} messages={[]} historyReady={false} error="Offline" />
    );
    rerender(<ChatPanel {...props} messages={[message('history')]} historyReady />);
    expect(screen.queryByText('1')).toBeNull();
    rerender(<ChatPanel {...props} messages={[message('history'), message('new')]} historyReady />);
    expect(screen.getByText('1')).toBeDefined();
  });

  it('does not count messages before the current user is known', () => {
    const props = { onSend: vi.fn(), sending: false, historyReady: true };
    const { rerender } = render(<ChatPanel {...props} messages={[]} />);
    rerender(<ChatPanel {...props} messages={[message('own', 'me')]} />);
    expect(screen.queryByText('1')).toBeNull();
    rerender(<ChatPanel {...props} currentUserId="me" messages={[message('own', 'me')]} />);
    rerender(
      <ChatPanel {...props} currentUserId="me" messages={[message('own', 'me'), message('new')]} />
    );
    expect(screen.getByText('1')).toBeDefined();
  });
});

function SessionChat({
  sessionId = 'room',
  enabled = true,
}: {
  sessionId?: string;
  enabled?: boolean;
}) {
  const chat = useChat({ sessionId, enabled });
  return (
    <ChatPanel
      key={sessionId}
      messages={chat.messages}
      onSend={chat.sendMessage}
      sending={chat.sending}
      loading={chat.loading}
      historyReady={chat.historyReady}
      error={chat.error}
      currentUserId="me"
    />
  );
}

describe('panel and hook lifecycle together', () => {
  it('restores an in-flight draft with an uncertainty warning when chat is disabled', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({ data: { messages: [], hasMore: false } });
    vi.mocked(chatApi.send).mockImplementationOnce(
      (_room, _content, _participant, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => resolve({ error: 'Aborted', failureKind: 'unknown' }),
            { once: true }
          );
        })
    );
    const { rerender } = render(<SessionChat />);
    open();
    fireEvent.change(input(), { target: { value: 'pending draft' } });
    fireEvent.click(screen.getByText('Send'));
    rerender(<SessionChat enabled={false} />);
    await waitFor(() => expect(input().value).toBe('pending draft'));
    expect(screen.getByText(/may have been sent/)).toBeDefined();
    expect(chatApi.send).toHaveBeenCalledTimes(1);
  });

  it('does not put a late old-room response or draft into a new room', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue({ data: { messages: [], hasMore: false } });
    let complete!: (value: { data: Message }) => void;
    vi.mocked(chatApi.send).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    const { rerender } = render(<SessionChat />);
    open();
    fireEvent.change(input(), { target: { value: 'old room secret' } });
    fireEvent.click(screen.getByText('Send'));
    rerender(<SessionChat sessionId="new-room" />);
    open();
    fireEvent.change(input(), { target: { value: 'new room draft' } });
    await act(async () => {
      complete({ data: { ...message('old'), content: 'old room secret' } });
    });
    expect(input().value).toBe('new room draft');
    expect(screen.queryByText('old room secret')).toBeNull();
    expect(screen.queryByText(/may have been sent/)).toBeNull();
  });
});
