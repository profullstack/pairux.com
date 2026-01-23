import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Suspense } from 'react';
import SessionViewerPage from './page';

// Mock the useWebRTC hook
vi.mock('@/hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    connectionState: 'idle',
    remoteStream: null,
    qualityMetrics: null,
    networkQuality: 'good',
    error: null,
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  }),
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
});
