import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';
import SessionViewerPage from './page';

// Mock the useWebRTC hook
const mockToggleMic = vi.fn();
const mockUseWebRTC = {
  connectionState: 'idle' as const,
  remoteStream: null,
  qualityMetrics: null,
  networkQuality: 'good' as const,
  error: null,
  reconnect: vi.fn(),
  disconnect: vi.fn(),
  // Remote control
  controlState: 'view-only' as const,
  dataChannelReady: false,
  requestControl: vi.fn(),
  releaseControl: vi.fn(),
  sendInput: vi.fn(),
  sendCursorPosition: vi.fn(),
  // Microphone
  micEnabled: false,
  hasMic: true,
  toggleMic: mockToggleMic,
};

vi.mock('@/hooks/useWebRTC', () => ({
  useWebRTC: () => mockUseWebRTC,
}));

vi.mock('@/hooks/useSessionPresence', () => ({
  useSessionPresence: () => ({
    status: 'active',
    currentHostId: 'host-123',
    hostOnline: true,
  }),
}));

vi.mock('@/components/chat/ChatPanel', () => ({
  ChatPanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="chat-panel">Chat for {sessionId}</div>
  ),
}));

vi.mock('@/components/session/SessionSettingsPanel', () => ({
  SessionSettingsPanel: () => <div data-testid="session-settings-panel">Settings Panel</div>,
}));

vi.mock('@/components/session/HostPresenceIndicator', () => ({
  HostPresenceIndicator: () => null,
}));

// Create a stable promise that resolves immediately
function createResolvedParams(id: string) {
  return Promise.resolve({ id });
}

function renderWithSuspense(ui: React.ReactElement) {
  return render(<Suspense fallback={<div>Suspense loading...</div>}>{ui}</Suspense>);
}

describe('SessionViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockReset();
  });

  describe('Loading state', () => {
    it('shows loading spinner while fetching session', async () => {
      vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));

      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Loading session...')).toBeInTheDocument();
      });
    });
  });

  describe('Session not found', () => {
    it('shows error when session does not exist', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Session not found' }),
      } as Response);

      const params = createResolvedParams('invalid-id');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Session Not Found')).toBeInTheDocument();
      });
      expect(screen.getByText('Session not found')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to Homepage' })).toHaveAttribute('href', '/');
    });
  });

  describe('Session loaded', () => {
    const mockSessionData = {
      id: 'session-123',
      join_code: 'ABC123',
      status: 'active',
      settings: { quality: 'medium', allowControl: false, maxParticipants: 5 },
      created_at: '2024-01-01T00:00:00Z',
      session_participants: [
        {
          id: 'p-1',
          display_name: 'Host User',
          role: 'host',
          control_state: 'granted',
          joined_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'p-2',
          display_name: 'Viewer One',
          role: 'viewer',
          control_state: 'view-only',
          joined_at: '2024-01-01T00:01:00Z',
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockSessionData }),
      } as Response);
    });

    it('displays session code in header', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('ABC123')).toBeInTheDocument();
      });
    });

    it('shows connection status badge', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      // When WebRTC is in idle state, it shows "Waiting"
      await waitFor(() => {
        expect(screen.getByText('Waiting')).toBeInTheDocument();
      });
    });

    it('shows waiting for screen share message', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Waiting for screen share')).toBeInTheDocument();
      });
      expect(
        screen.getByText(/The host hasn't started sharing their screen yet/)
      ).toBeInTheDocument();
    });

    it('displays participant count in sidebar', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Participants (2)')).toBeInTheDocument();
      });
    });

    it('displays participant list in sidebar', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Host User')).toBeInTheDocument();
      });
      expect(screen.getByText('Viewer One')).toBeInTheDocument();
    });

    it('shows participant roles', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('host')).toBeInTheDocument();
      });
      expect(screen.getByText('viewer')).toBeInTheDocument();
    });

    it('has leave button that links to homepage', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /Leave/ })).toBeInTheDocument();
      });
      expect(screen.getByRole('link', { name: /Leave/ })).toHaveAttribute('href', '/');
    });

    it('has chat and settings buttons', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Chat/ })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
    });
  });

  describe('Non-active session status', () => {
    it('shows WebRTC connection status badge regardless of session status', async () => {
      const mockSessionData = {
        id: 'session-123',
        join_code: 'ABC123',
        status: 'paused',
        settings: {},
        created_at: '2024-01-01T00:00:00Z',
        session_participants: [],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockSessionData }),
      } as Response);

      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      // The badge now shows WebRTC connection state, not session status
      await waitFor(() => {
        expect(screen.getByText('Waiting')).toBeInTheDocument();
      });
    });
  });

  describe('Microphone toggle', () => {
    const mockSessionData = {
      id: 'session-123',
      join_code: 'ABC123',
      status: 'active',
      settings: { quality: 'medium', allowControl: false, maxParticipants: 5 },
      created_at: '2024-01-01T00:00:00Z',
      session_participants: [
        {
          id: 'p-1',
          display_name: 'Host User',
          role: 'host',
          control_state: 'granted',
          joined_at: '2024-01-01T00:00:00Z',
        },
      ],
    };

    it('shows mic off button when mic is disabled', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockSessionData }),
      } as Response);

      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Mic Off/ })).toBeInTheDocument();
      });
    });

    it('calls toggleMic when mic button is clicked', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockSessionData }),
      } as Response);

      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Mic Off/ })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Mic Off/ }));
      expect(mockToggleMic).toHaveBeenCalled();
    });
  });

  describe('Participant filtering', () => {
    it('excludes participants who have left from count', async () => {
      const mockSessionData = {
        id: 'session-123',
        join_code: 'ABC123',
        status: 'active',
        settings: {},
        created_at: '2024-01-01T00:00:00Z',
        session_participants: [
          {
            id: 'p-1',
            display_name: 'Active User',
            role: 'viewer',
            control_state: 'view-only',
            joined_at: '2024-01-01T00:00:00Z',
          },
          {
            id: 'p-2',
            display_name: 'Left User',
            role: 'left',
            control_state: 'view-only',
            joined_at: '2024-01-01T00:00:00Z',
          },
        ],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockSessionData }),
      } as Response);

      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Participants (1)')).toBeInTheDocument();
      });
      expect(screen.getByText('Active User')).toBeInTheDocument();
      expect(screen.queryByText('Left User')).not.toBeInTheDocument();
    });
  });

  describe('Sidebar panel toggling', () => {
    const mockSessionData = {
      id: 'session-123',
      join_code: 'ABC123',
      status: 'active',
      settings: { quality: 'medium', allowControl: false, maxParticipants: 5 },
      created_at: '2024-01-01T00:00:00Z',
      session_participants: [
        {
          id: 'p-1',
          display_name: 'Host User',
          role: 'host',
          control_state: 'granted',
          joined_at: '2024-01-01T00:00:00Z',
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockSessionData }),
      } as Response);
    });

    it('shows participants panel by default', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Participants (1)')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-settings-panel')).not.toBeInTheDocument();
    });

    it('switches to chat panel when Chat button is clicked', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Chat/ })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Chat/ }));

      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
      expect(screen.queryByText('Participants (1)')).not.toBeInTheDocument();
    });

    it('switches to settings panel when Settings button is clicked', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Settings/ }));

      expect(screen.getByTestId('session-settings-panel')).toBeInTheDocument();
      expect(screen.queryByText('Participants (1)')).not.toBeInTheDocument();
    });

    it('closes sidebar when active panel button is clicked again', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Participants (1)')).toBeInTheDocument();
      });

      // Click Participants button to toggle off
      fireEvent.click(screen.getByRole('button', { name: /Participants/ }));

      expect(screen.queryByText('Participants (1)')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    });

    it('switches between panels without closing sidebar', async () => {
      const params = createResolvedParams('session-123');

      await act(async () => {
        renderWithSuspense(<SessionViewerPage params={params} />);
      });

      await waitFor(() => {
        expect(screen.getByText('Participants (1)')).toBeInTheDocument();
      });

      // Switch to chat
      fireEvent.click(screen.getByRole('button', { name: /Chat/ }));
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();

      // Switch to settings
      fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
      expect(screen.getByTestId('session-settings-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();

      // Switch back to participants
      fireEvent.click(screen.getByRole('button', { name: /Participants/ }));
      expect(screen.getByText('Participants (1)')).toBeInTheDocument();
      expect(screen.queryByTestId('session-settings-panel')).not.toBeInTheDocument();
    });
  });
});
