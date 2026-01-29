import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';

// Override next/navigation mock from setup to include participant ID in searchParams
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'p' ? 'part-1' : null),
  }),
  usePathname: () => '/test',
}));

import GuestSessionViewerPage from './page';

// --- Mock hooks ---

const mockToggleMic = vi.fn();
const mockRequestControl = vi.fn();
const mockReleaseControl = vi.fn();
const mockReconnect = vi.fn();
const mockSendInput = vi.fn();
const mockSendCursorPosition = vi.fn();

const mockWebRTCResult = {
  connectionState: 'connected' as const,
  remoteStream: null,
  qualityMetrics: null,
  networkQuality: 'good' as const,
  error: null,
  reconnect: mockReconnect,
  controlState: 'view-only' as const,
  dataChannelReady: false,
  requestControl: mockRequestControl,
  releaseControl: mockReleaseControl,
  sendInput: mockSendInput,
  sendCursorPosition: mockSendCursorPosition,
  micEnabled: false,
  hasMic: true,
  toggleMic: mockToggleMic,
};

vi.mock('@/hooks/useWebRTC', () => ({
  useWebRTC: () => mockWebRTCResult,
}));

vi.mock('@/hooks/useWebRTCSFU', () => ({
  useWebRTCSFU: () => mockWebRTCResult,
}));

vi.mock('@/hooks/useSessionPresence', () => ({
  useSessionPresence: () => ({
    status: 'active',
    currentHostId: 'host-1',
    hostOnline: true,
  }),
}));

vi.mock('@/components/session/HostPresenceIndicator', () => ({
  HostPresenceIndicator: () => null,
}));

vi.mock('@/components/video', () => ({
  VideoViewer: () => <div data-testid="video-viewer">VideoViewer</div>,
}));

vi.mock('@/components/control', () => ({
  ControlRequestButton: () => <div data-testid="control-button">ControlButton</div>,
  ControlStatusIndicator: () => null,
  InputCapture: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CursorOverlay: () => null,
}));

vi.mock('@/components/Logo', () => ({
  Logo: () => <div data-testid="logo">Logo</div>,
}));

const mockParticipant = {
  id: 'part-1',
  display_name: 'Test Viewer',
  role: 'viewer',
  control_state: 'none',
  joined_at: new Date().toISOString(),
};

const mockSession = {
  id: 'session-1',
  join_code: 'ABC123',
  status: 'active',
  mode: 'p2p' as const,
  settings: {
    quality: '1080p',
    allowControl: false,
    maxParticipants: 10,
  },
  created_at: new Date().toISOString(),
  session_participants: [
    {
      id: 'part-host',
      display_name: 'Host User',
      role: 'host',
      control_state: 'none',
      joined_at: new Date().toISOString(),
    },
    mockParticipant,
  ],
};

function createResolvedParams(sessionId: string) {
  return Promise.resolve({ sessionId });
}

function renderWithSuspense(ui: React.ReactElement) {
  return render(<Suspense fallback={<div>Suspense loading...</div>}>{ui}</Suspense>);
}

describe('GuestSessionViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock hook values
    mockWebRTCResult.micEnabled = false;
    mockWebRTCResult.hasMic = true;
    mockWebRTCResult.connectionState = 'connected';
    mockWebRTCResult.error = null;

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            session: mockSession,
            participant: mockParticipant,
          },
        }),
    } as Response);
  });

  it('should show loading state initially', async () => {
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Loading session...')).toBeInTheDocument();
    });
  });

  it('should show error when access is denied', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Session not found' }),
    } as Response);

    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
    });
  });

  it('should render mic toggle button', async () => {
    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Mic Off')).toBeInTheDocument();
    });
  });

  it('should show Mic On when mic is enabled', async () => {
    mockWebRTCResult.micEnabled = true;

    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Mic On')).toBeInTheDocument();
    });
  });

  it('should call toggleMic when mic button is clicked', async () => {
    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Mic Off')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Mic Off'));
    });

    expect(mockToggleMic).toHaveBeenCalledOnce();
  });

  it('should disable mic button when hasMic is false', async () => {
    mockWebRTCResult.hasMic = false;

    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      const micButton = screen.getByText('Mic Off').closest('button');
      expect(micButton).toBeDisabled();
    });
  });

  it('should display join code', async () => {
    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });
  });

  it('should display participant list in sidebar', async () => {
    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      // Sidebar shows participant count
      expect(screen.getByText(/Participants/)).toBeInTheDocument();
    });
  });

  it('should render video viewer component', async () => {
    await act(async () => {
      renderWithSuspense(<GuestSessionViewerPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('video-viewer')).toBeInTheDocument();
    });
  });
});
