import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';
import HostSessionPage from './page';
import type { ViewerConnection } from '@/hooks/useWebRTCHost';

// --- Mock hooks ---

const mockGrantControl = vi.fn();
const mockRevokeControl = vi.fn();
const mockKickViewer = vi.fn();
const mockToggleMic = vi.fn();
const mockStartHosting = vi.fn().mockResolvedValue(undefined);
const mockStopHosting = vi.fn();

const mockViewers = new Map<string, ViewerConnection>();

const mockHostHookResult = {
  isHosting: false,
  viewerCount: 0,
  viewers: mockViewers,
  error: null,
  startHosting: mockStartHosting,
  stopHosting: mockStopHosting,
  grantControl: mockGrantControl,
  revokeControl: mockRevokeControl,
  kickViewer: mockKickViewer,
  micEnabled: false,
  hasMic: true,
  toggleMic: mockToggleMic,
  micStream: null,
};

vi.mock('@/hooks/useWebRTCHost', () => ({
  useWebRTCHost: () => mockHostHookResult,
  // ViewerConnection type re-export
}));

vi.mock('@/hooks/useWebRTCHostSFU', () => ({
  useWebRTCHostSFU: () => mockHostHookResult,
}));

// Mock useParticipants to return live participants
const mockLiveParticipants = [
  {
    id: 'part-host',
    session_id: 'session-1',
    user_id: 'host-1',
    role: 'host',
    display_name: 'Host User',
    joined_at: new Date().toISOString(),
    left_at: null,
  },
  {
    id: 'part-viewer-1',
    session_id: 'session-1',
    user_id: 'viewer-1',
    role: 'viewer',
    display_name: 'Viewer One',
    joined_at: new Date().toISOString(),
    left_at: null,
  },
];

vi.mock('@/components/chat/useParticipants', () => ({
  useParticipants: () => ({
    participants: mockLiveParticipants,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Mock screen capture
vi.mock('@/hooks/useScreenCapture', () => ({
  useScreenCapture: () => ({
    stream: null,
    captureState: 'idle',
    error: null,
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
  }),
}));

// Mock recording
vi.mock('@/hooks/useRecording', () => ({
  useRecording: () => ({
    isRecording: false,
    isPaused: false,
    duration: 0,
    error: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    downloadRecording: vi.fn(),
  }),
  formatDuration: (d: number) => `${String(d)}s`,
}));

// Mock audio mixer
vi.mock('@/hooks/useAudioMixer', () => ({
  useAudioMixer: () => ({
    mixedStream: null,
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    setTrackMuted: vi.fn(),
    dispose: vi.fn(),
  }),
}));

// Track HostParticipantList props
let capturedHostParticipantListProps: Record<string, unknown> | null = null;

vi.mock('@/components/participants/HostParticipantList', () => ({
  HostParticipantList: (props: Record<string, unknown>) => {
    capturedHostParticipantListProps = props;
    const participants = props.participants as unknown[] | undefined;
    const count = participants ? participants.length : 0;
    return (
      <div data-testid="host-participant-list">HostParticipantList ({count} participants)</div>
    );
  },
}));

vi.mock('@/components/chat/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel">ChatPanel</div>,
}));

vi.mock('@/components/video', () => ({
  VideoPreview: () => <div data-testid="video-preview">VideoPreview</div>,
}));

vi.mock('@/components/Logo', () => ({
  Logo: () => <div data-testid="logo">Logo</div>,
}));

function createResolvedParams(id: string) {
  return Promise.resolve({ id });
}

function renderWithSuspense(ui: React.ReactElement) {
  return render(<Suspense fallback={<div>Suspense loading...</div>}>{ui}</Suspense>);
}

const mockSessionData = {
  id: 'session-1',
  join_code: 'ABC123',
  status: 'active',
  mode: 'p2p' as const,
  host_user_id: 'host-1',
  settings: {
    quality: '1080p',
    allowControl: false,
    maxParticipants: 10,
  },
  created_at: new Date().toISOString(),
  session_participants: mockLiveParticipants,
};

describe('HostSessionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHostParticipantListProps = null;
    mockViewers.clear();

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: mockSessionData }),
    } as Response);
  });

  it('should show loading state initially', async () => {
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Loading session...')).toBeInTheDocument();
    });
  });

  it('should show error when session not found', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Session not found' }),
    } as Response);

    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Session Not Found')).toBeInTheDocument();
    });
  });

  it('should render HostParticipantList in sidebar', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('host-participant-list')).toBeInTheDocument();
    });
  });

  it('should pass live participants to HostParticipantList', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(capturedHostParticipantListProps).not.toBeNull();
    });

    expect(capturedHostParticipantListProps!.participants).toBe(mockLiveParticipants);
  });

  it('should pass viewers map to HostParticipantList', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(capturedHostParticipantListProps).not.toBeNull();
    });

    expect(capturedHostParticipantListProps!.viewers).toBe(mockViewers);
  });

  it('should pass currentUserId to HostParticipantList', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(capturedHostParticipantListProps).not.toBeNull();
    });

    expect(capturedHostParticipantListProps!.currentUserId).toBe('host-1');
  });

  it('should wire grantControl handler to HostParticipantList', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(capturedHostParticipantListProps).not.toBeNull();
    });

    const onGrantControl = capturedHostParticipantListProps!.onGrantControl as (id: string) => void;
    onGrantControl('viewer-1');
    expect(mockGrantControl).toHaveBeenCalledWith('viewer-1');
  });

  it('should wire revokeControl handler to HostParticipantList', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(capturedHostParticipantListProps).not.toBeNull();
    });

    const onRevokeControl = capturedHostParticipantListProps!.onRevokeControl as (
      id: string
    ) => void;
    onRevokeControl('viewer-1');
    expect(mockRevokeControl).toHaveBeenCalledWith('viewer-1');
  });

  it('should wire kickParticipant handler to HostParticipantList', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(capturedHostParticipantListProps).not.toBeNull();
    });

    const onKickParticipant = capturedHostParticipantListProps!.onKickParticipant as (
      id: string
    ) => void;
    onKickParticipant('viewer-1');
    expect(mockKickViewer).toHaveBeenCalledWith('viewer-1');
  });

  it('should display join code', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });
  });

  it('should show viewer count', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('0 viewers')).toBeInTheDocument();
    });
  });

  it('should display session mode', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/P2P/)).toBeInTheDocument();
    });
  });

  it('should show SFU mode for sfu sessions', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { ...mockSessionData, mode: 'sfu' } }),
    } as Response);

    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/SFU/)).toBeInTheDocument();
    });
  });

  it('should show Leave button instead of End', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Leave')).toBeInTheDocument();
    });
    expect(screen.queryByText('End')).not.toBeInTheDocument();
  });

  it('should show Reset Invite Link button', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Reset Invite Link')).toBeInTheDocument();
    });
  });

  it('should call DELETE API when Leave is clicked', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Leave')).toBeInTheDocument();
    });

    // Clear the initial fetch mock
    vi.mocked(global.fetch).mockClear();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as Response);

    await act(async () => {
      fireEvent.click(screen.getByText('Leave'));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/session-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  it('should regenerate join code and update display', async () => {
    await act(async () => {
      renderWithSuspense(<HostSessionPage params={createResolvedParams('session-1')} />);
    });

    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    // Mock confirm dialog
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Mock the regenerate API response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { ...mockSessionData, join_code: 'XYZ789' } }),
    } as Response);

    await act(async () => {
      fireEvent.click(screen.getByText('Reset Invite Link'));
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/session-1/regenerate-code',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
