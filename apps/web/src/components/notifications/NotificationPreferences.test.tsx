import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationPreferences } from './NotificationPreferences';

// Mock the usePushNotifications hook
const mockSubscribe = vi.fn().mockResolvedValue(true);
const mockUnsubscribe = vi.fn().mockResolvedValue(true);

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: vi.fn(() => ({
    isSupported: true,
    permission: 'default' as NotificationPermission,
    isSubscribed: false,
    isLoading: false,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  })),
}));

import { usePushNotifications } from '@/hooks/usePushNotifications';

describe('NotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { settings: {} } }),
    } as Response);
  });

  it('should show unsupported message when push is not available', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: false,
      permission: 'default',
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    expect(screen.getByText(/not supported/i)).toBeInTheDocument();
  });

  it('should show enable button when not subscribed', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    expect(screen.getByRole('button', { name: /enable/i })).toBeInTheDocument();
    expect(screen.getByText(/enable to receive notifications/i)).toBeInTheDocument();
  });

  it('should show disable button when subscribed', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isSubscribed: true,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
    expect(screen.getByText(/notifications are enabled/i)).toBeInTheDocument();
  });

  it('should call subscribe when enable button is clicked', async () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    fireEvent.click(screen.getByRole('button', { name: /enable/i }));

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  it('should call unsubscribe when disable button is clicked', async () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isSubscribed: true,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    fireEvent.click(screen.getByRole('button', { name: /disable/i }));

    await waitFor(() => {
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  it('should show notification blocked message when permission is denied', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'denied',
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    expect(screen.getByText(/blocked in browser settings/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable/i })).toBeDisabled();
  });

  it('should disable button while loading', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isSubscribed: false,
      isLoading: true,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    const buttons = screen.getAllByRole('button');
    const subscribeButton = buttons.find(
      (b) => b.textContent !== '' || b.querySelector('.animate-spin')
    );
    expect(subscribeButton).toBeDisabled();
  });

  it('should show event toggles when subscribed', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isSubscribed: true,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    expect(screen.getByText('Control requests')).toBeInTheDocument();
    expect(screen.getByText('Chat messages')).toBeInTheDocument();
    expect(screen.getByText('Participant joined')).toBeInTheDocument();
    expect(screen.getByText('Participant left')).toBeInTheDocument();
    expect(screen.getByText('Host disconnected')).toBeInTheDocument();
  });

  it('should not show event toggles when not subscribed', () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'default',
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPreferences />);

    expect(screen.queryByText('Control requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Chat messages')).not.toBeInTheDocument();
  });

  it('should load preferences from server on mount', async () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isSubscribed: true,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            settings: {
              notifications: {
                pushEnabled: true,
                chatMessage: false,
                controlRequest: true,
              },
            },
          },
        }),
    } as Response);

    render(<NotificationPreferences />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings');
    });
  });

  it('should save preference when toggle is clicked', async () => {
    vi.mocked(usePushNotifications).mockReturnValue({
      isSupported: true,
      permission: 'granted',
      isSubscribed: true,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    // Initial load
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { settings: {} } }),
    } as Response);

    render(<NotificationPreferences />);

    // Wait for initial load
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings');
    });

    // Find the toggle for "Chat messages"
    const chatLabel = screen.getByText('Chat messages');
    const toggleContainer = chatLabel.closest('div');
    const toggle = toggleContainer?.querySelector('button');
    expect(toggle).toBeTruthy();

    // Mock the GET and PUT for saving
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { settings: {} } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      } as Response);

    fireEvent.click(toggle!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });
  });
});
