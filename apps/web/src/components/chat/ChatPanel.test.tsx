import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

// Mock scrollIntoView for tests
Element.prototype.scrollIntoView = vi.fn();

// Mock the useChat hook
vi.mock('./useChat', () => ({
  useChat: vi.fn(),
}));

// Mock the useParticipants hook
vi.mock('./useParticipants', () => ({
  useParticipants: vi.fn(),
}));

// Mock the useTypingIndicator hook
vi.mock('./useTypingIndicator', () => ({
  useTypingIndicator: vi.fn(() => ({
    emitTyping: vi.fn(),
    stopTyping: vi.fn(),
    typingUsers: [],
  })),
}));

import { useChat } from './useChat';
import { useParticipants } from './useParticipants';

const mockMessages = [
  {
    id: 'msg-1',
    session_id: 'test-session',
    user_id: 'user-1',
    display_name: 'Alice',
    content: 'Hello!',
    message_type: 'text' as const,
    created_at: '2024-01-01T00:00:00Z',
    recipient_id: null,
  },
  {
    id: 'msg-2',
    session_id: 'test-session',
    user_id: null,
    display_name: 'System',
    content: 'Bob joined the session',
    message_type: 'system' as const,
    created_at: '2024-01-01T00:01:00Z',
    recipient_id: null,
  },
];

describe('ChatPanel', () => {
  const mockSendMessage = vi.fn();
  const mockLoadMore = vi.fn();
  const mockReconnect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useChat).mockReturnValue({
      messages: mockMessages,
      isConnected: true,
      isLoading: false,
      error: null,
      hasMore: false,
      sendMessage: mockSendMessage,
      loadMore: mockLoadMore,
      reconnect: mockReconnect,
    });

    vi.mocked(useParticipants).mockReturnValue({
      participants: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('renders chat panel with messages', () => {
    render(<ChatPanel sessionId="test-session" />);

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.getByText('Bob joined the session')).toBeInTheDocument();
  });

  it('shows connection status indicator', () => {
    render(<ChatPanel sessionId="test-session" />);

    // Connected - should show green wifi icon
    expect(screen.getByLabelText('Connected')).toBeInTheDocument();
  });

  it('shows disconnected status when not connected', () => {
    vi.mocked(useChat).mockReturnValue({
      messages: [],
      isConnected: false,
      isLoading: false,
      error: null,
      hasMore: false,
      sendMessage: mockSendMessage,
      loadMore: mockLoadMore,
      reconnect: mockReconnect,
    });

    render(<ChatPanel sessionId="test-session" />);

    expect(screen.getByLabelText('Disconnected')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    vi.mocked(useChat).mockReturnValue({
      messages: [],
      isConnected: true,
      isLoading: true,
      error: null,
      hasMore: false,
      sendMessage: mockSendMessage,
      loadMore: mockLoadMore,
      reconnect: mockReconnect,
    });

    render(<ChatPanel sessionId="test-session" />);

    // Chat panel should be present (loading state is inside)
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    // Should have a loading spinner (Loader2 icon with animate-spin class)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error message with retry button', () => {
    vi.mocked(useChat).mockReturnValue({
      messages: [],
      isConnected: false,
      isLoading: false,
      error: 'Connection lost',
      hasMore: false,
      sendMessage: mockSendMessage,
      loadMore: mockLoadMore,
      reconnect: mockReconnect,
    });

    render(<ChatPanel sessionId="test-session" />);

    expect(screen.getByText('Connection lost')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));
    expect(mockReconnect).toHaveBeenCalled();
  });

  it('can collapse and expand', () => {
    render(<ChatPanel sessionId="test-session" />);

    // Initially expanded
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();

    // Click collapse button
    const collapseButton = screen.getByLabelText('Close chat');
    fireEvent.click(collapseButton);

    // Should show collapsed state
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Open chat')).toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByLabelText('Open chat'));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('disables input when disconnected', () => {
    vi.mocked(useChat).mockReturnValue({
      messages: [],
      isConnected: false,
      isLoading: false,
      error: null,
      hasMore: false,
      sendMessage: mockSendMessage,
      loadMore: mockLoadMore,
      reconnect: mockReconnect,
    });

    render(<ChatPanel sessionId="test-session" />);

    const input = screen.getByTestId('chat-input');
    expect(input).toBeDisabled();
  });

  it('sends message when form is submitted', async () => {
    mockSendMessage.mockResolvedValue(undefined);

    render(<ChatPanel sessionId="test-session" />);

    const input = screen.getByTestId('chat-input');
    const sendButton = screen.getByTestId('chat-send-button');

    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith('Test message');
    });
  });

  it('passes participantId to useChat', () => {
    render(<ChatPanel sessionId="test-session" participantId="guest-123" />);

    expect(useChat).toHaveBeenCalledWith({
      sessionId: 'test-session',
      participantId: 'guest-123',
    });
  });

  describe('dark theme styling', () => {
    it('renders panel container with dark background and border', () => {
      render(<ChatPanel sessionId="test-session" />);

      const panel = screen.getByTestId('chat-panel');
      expect(panel.className).toContain('bg-gray-900');
      expect(panel.className).toContain('border-gray-700');
    });

    it('renders header with dark border', () => {
      render(<ChatPanel sessionId="test-session" />);

      const panel = screen.getByTestId('chat-panel');
      // Header is the first child div with border-b
      const header = panel.querySelector('.border-b.border-gray-700');
      expect(header).toBeInTheDocument();
    });

    it('renders header title with white text', () => {
      render(<ChatPanel sessionId="test-session" />);

      const chatTitle = screen.getByText('Chat');
      expect(chatTitle.className).toContain('text-white');
    });

    it('renders error banner with dark theme classes', () => {
      vi.mocked(useChat).mockReturnValue({
        messages: [],
        isConnected: false,
        isLoading: false,
        error: 'Connection lost',
        hasMore: false,
        sendMessage: mockSendMessage,
        loadMore: mockLoadMore,
        reconnect: mockReconnect,
      });

      render(<ChatPanel sessionId="test-session" />);

      const errorBanner = screen.getByText('Connection lost').closest('div');
      expect(errorBanner?.className).toContain('bg-red-900/30');
      expect(errorBanner?.className).toContain('text-red-400');
      expect(errorBanner?.className).toContain('border-red-800');
    });

    it('renders collapsed button with dark background', () => {
      render(<ChatPanel sessionId="test-session" />);

      // Collapse the panel
      fireEvent.click(screen.getByLabelText('Close chat'));

      const openButton = screen.getByLabelText('Open chat');
      expect(openButton.className).toContain('bg-gray-900');
      expect(openButton.className).toContain('border-gray-700');
    });

    it('does not contain light theme classes', () => {
      render(<ChatPanel sessionId="test-session" />);

      const panel = screen.getByTestId('chat-panel');
      expect(panel.className).not.toContain('bg-white');
      expect(panel.className).not.toContain('border-gray-200');
    });
  });
});
