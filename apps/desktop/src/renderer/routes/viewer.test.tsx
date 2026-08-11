import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ViewerPage } from './viewer';
import type { Session, SessionParticipant } from '@pairux/shared-types';

// Navigation tracking
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock auth store
const mockUser = { id: 'user-1', email: 'test@test.com', display_name: 'Test User' };
vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (s: { user: typeof mockUser | null }) => unknown) =>
    selector({ user: mockUser }),
}));

// Mock IPC
const mockInvoke = vi.fn();
vi.mock('@/lib/ipc', () => ({
  getElectronAPI: () => ({
    invoke: mockInvoke,
  }),
}));

// Mock WebRTC hooks
const mockP2PHookResult: {
  connectionState: string;
  remoteStream: MediaStream | null;
  error: string | null;
  reconnect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  controlState: string;
  dataChannelReady: boolean;
  requestControl: ReturnType<typeof vi.fn>;
  releaseControl: ReturnType<typeof vi.fn>;
  micEnabled: boolean;
  hasMic: boolean;
  toggleMic: ReturnType<typeof vi.fn>;
  qualityMetrics: null;
  networkQuality: string;
  sendInput: ReturnType<typeof vi.fn>;
} = {
  connectionState: 'connected',
  remoteStream: null,
  error: null,
  reconnect: vi.fn(),
  disconnect: vi.fn(),
  controlState: 'view-only',
  dataChannelReady: true,
  requestControl: vi.fn(),
  releaseControl: vi.fn(),
  micEnabled: true,
  hasMic: true,
  toggleMic: vi.fn(),
  qualityMetrics: null,
  networkQuality: 'good',
  sendInput: vi.fn(),
};

const mockSFUHookResult = {
  ...mockP2PHookResult,
};

vi.mock('@/hooks/useWebRTCViewerAPI', () => ({
  useWebRTCViewerAPI: (opts: { onKicked?: () => void; onPresenceChange?: () => void }) => {
    // Store callback for testing
    (mockP2PHookResult as Record<string, unknown>)._onKicked = opts.onKicked;
    (mockP2PHookResult as Record<string, unknown>)._onPresenceChange = opts.onPresenceChange;
    return mockP2PHookResult;
  },
}));

vi.mock('@/hooks/useWebRTCViewerSFUAPI', () => ({
  useWebRTCViewerSFUAPI: (opts: { onKicked?: () => void; onPresenceChange?: () => void }) => {
    (mockSFUHookResult as Record<string, unknown>)._onKicked = opts.onKicked;
    (mockSFUHookResult as Record<string, unknown>)._onPresenceChange = opts.onPresenceChange;
    return mockSFUHookResult;
  },
}));

// Mock VideoViewer
vi.mock('@/components/video/VideoViewer', () => ({
  VideoViewer: ({ connectionState, error }: { connectionState: string; error?: string | null }) => (
    <div data-testid="video-viewer" data-connection={connectionState} data-error={error ?? ''}>
      VideoViewer
    </div>
  ),
}));

// Mock ChatPanel
vi.mock('@/components/chat', () => ({
  ChatPanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="chat-panel" data-session={sessionId}>
      ChatPanel
    </div>
  ),
}));

function renderWithRouter(sessionId = 'session-1') {
  return render(
    <MemoryRouter initialEntries={[`/viewer/${sessionId}`]}>
      <Routes>
        <Route path="/viewer/:sessionId" element={<ViewerPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const makeSession = (overrides?: Partial<Session>): Session => ({
  id: 'session-1',
  host_user_id: 'host-1',
  creator_id: 'host-1',
  current_host_id: 'host-1',
  join_code: 'ABC123',
  status: 'active',
  mode: 'p2p',
  settings: { maxParticipants: 10 },
  host_last_seen_at: null,
  expires_at: null,
  is_public: false,
  subject: null,
  description: null,
  banner_url: null,
  published_at: null,
  created_at: new Date().toISOString(),
  ended_at: null,
  ...overrides,
});

const makeParticipants = (): SessionParticipant[] => [
  {
    id: 'part-host',
    session_id: 'session-1',
    user_id: 'host-1',
    role: 'host',
    display_name: 'Host User',
    control_state: 'view-only',
    is_backup_host: false,
    connection_status: 'connected',
    last_seen_at: null,
    joined_at: new Date().toISOString(),
    left_at: null,
  },
  {
    id: 'part-viewer',
    session_id: 'session-1',
    user_id: 'user-1',
    role: 'viewer',
    display_name: 'Test User',
    control_state: 'view-only',
    is_backup_host: false,
    connection_status: 'connected',
    last_seen_at: null,
    joined_at: new Date().toISOString(),
    left_at: null,
  },
];

describe('ViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({
      success: true,
      session: makeSession(),
      participants: makeParticipants(),
    });
    // Reset hook results
    mockP2PHookResult.connectionState = 'connected';
    mockP2PHookResult.remoteStream = null;
    mockP2PHookResult.error = null;
    mockP2PHookResult.micEnabled = true;
    mockP2PHookResult.hasMic = true;
    // Reset disconnect and toggleMic mocks
    mockP2PHookResult.disconnect = vi.fn();
    mockP2PHookResult.toggleMic = vi.fn();
    mockP2PHookResult.reconnect = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show loading state initially', () => {
    // Never resolve to keep loading state
    mockInvoke.mockReturnValue(new Promise(() => {}));
    renderWithRouter();
    expect(screen.getByText('Loading session...')).toBeInTheDocument();
  });

  it('should show session error when load fails', async () => {
    mockInvoke.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Session Error')).toBeInTheDocument();
    });
    expect(screen.getByText('Session not found')).toBeInTheDocument();
    expect(screen.getByText('Back to Join')).toBeInTheDocument();
  });

  it('should navigate to /join on Back to Join click', async () => {
    mockInvoke.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Back to Join')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Back to Join'));
    expect(mockNavigate).toHaveBeenCalledWith('/join');
  });

  it('should render P2P viewer for p2p session', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Viewing Session')).toBeInTheDocument();
    });

    expect(screen.getByText('Hosted by Host User')).toBeInTheDocument();
    expect(screen.getByText('P2P')).toBeInTheDocument();
    expect(screen.getByTestId('video-viewer')).toBeInTheDocument();
  });

  it('should render SFU viewer for sfu session', async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      session: makeSession({ mode: 'sfu' }),
      participants: makeParticipants(),
    });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Viewing Session')).toBeInTheDocument();
    });

    expect(screen.getByText('SFU')).toBeInTheDocument();
  });

  it('should show host display name', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Hosted by Host User')).toBeInTheDocument();
    });
  });

  it('should show join code', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });
  });

  it('should show participant count', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('2 participants')).toBeInTheDocument();
    });
  });

  it('should show session status', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });

  it('should show mic button with correct state', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Mic On')).toBeInTheDocument();
    });
  });

  // The desktop viewer previously received controlState/requestControl from
  // its hook and rendered nothing for them, so a participant joining from the
  // desktop app had no way to ask for control and no sign control existed.
  describe('remote control', () => {
    it('offers to request control when the session allows it', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        session: makeSession({ settings: { maxParticipants: 10, allowControl: true } }),
        participants: makeParticipants(),
      });

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Request Control/i })).toBeInTheDocument();
      });
    });

    it('asks the host when the button is clicked', async () => {
      mockP2PHookResult.requestControl = vi.fn();
      mockInvoke.mockResolvedValue({
        success: true,
        session: makeSession({ settings: { maxParticipants: 10, allowControl: true } }),
        participants: makeParticipants(),
      });

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Request Control/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Request Control/i }));
      expect(mockP2PHookResult.requestControl).toHaveBeenCalled();
    });

    it('shows the pending state while waiting on the host', async () => {
      mockP2PHookResult.controlState = 'requested';
      mockInvoke.mockResolvedValue({
        success: true,
        session: makeSession({ settings: { maxParticipants: 10, allowControl: true } }),
        participants: makeParticipants(),
      });

      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByText(/Requested/i)).toBeInTheDocument();
      });

      mockP2PHookResult.controlState = 'view-only';
    });

    it('hides control entirely when the session disallows it', async () => {
      renderWithRouter();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Share Screen/i })).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Request Control/i })).not.toBeInTheDocument();
    });
  });

  it('should show Share Screen button and navigate to presenter mode', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Share Screen/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Share Screen/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/?shareSessionId=session-1');
  });

  it('should call toggleMic when mic button is clicked', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Mic On')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mic On'));
    expect(mockP2PHookResult.toggleMic).toHaveBeenCalled();
  });

  it('should show chat panel by default', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    });
  });

  it('should toggle chat panel', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Chat'));

    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  it('should disconnect and navigate when leaving', async () => {
    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Leave Session')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Leave Session'));
    expect(mockP2PHookResult.disconnect).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/join');
  });

  it('should show error message when webrtcError is set and not failed/disconnected', async () => {
    mockP2PHookResult.error = 'Host disconnected. Waiting for reconnection...';
    mockP2PHookResult.connectionState = 'connected';

    renderWithRouter();

    await waitFor(() => {
      expect(
        screen.getByText('Host disconnected. Waiting for reconnection...')
      ).toBeInTheDocument();
    });
  });

  it('should not show inline error when connectionState is failed', async () => {
    mockP2PHookResult.error = 'Connection failed';
    mockP2PHookResult.connectionState = 'failed';

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Viewing Session')).toBeInTheDocument();
    });

    // The error should be displayed in VideoViewer, not the inline banner
    const videoViewer = screen.getByTestId('video-viewer');
    expect(videoViewer).toHaveAttribute('data-error', 'Connection failed');
  });

  it('should handle exception from session:get', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'));

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Failed to load session')).toBeInTheDocument();
    });
  });

  it('should pass correct props to VideoViewer', async () => {
    renderWithRouter();

    await waitFor(() => {
      const videoViewer = screen.getByTestId('video-viewer');
      expect(videoViewer).toHaveAttribute('data-connection', 'connected');
    });
  });

  it('should set up polling interval', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('Viewing Session')).toBeInTheDocument();
    });

    // Verify setInterval was called with 5000ms
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

    setIntervalSpy.mockRestore();
  });

  it('refreshes participant list immediately on presence change', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        success: true,
        session: makeSession(),
        participants: makeParticipants(),
      })
      .mockResolvedValueOnce({
        success: true,
        session: makeSession(),
        participants: [
          ...makeParticipants(),
          {
            id: 'part-viewer-2',
            session_id: 'session-1',
            user_id: 'user-2',
            role: 'viewer',
            display_name: 'Viewer Two',
            control_state: 'view-only',
            is_backup_host: false,
            connection_status: 'connected',
            last_seen_at: null,
            joined_at: new Date().toISOString(),
            left_at: null,
          } satisfies SessionParticipant,
        ],
      });

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('2 participants')).toBeInTheDocument();
    });

    await act(async () => {
      (mockP2PHookResult as unknown as { _onPresenceChange?: () => void })._onPresenceChange?.();
    });

    await waitFor(() => {
      expect(screen.getByText('3 participants')).toBeInTheDocument();
    });
  });
});
