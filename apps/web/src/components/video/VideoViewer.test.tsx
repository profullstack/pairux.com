import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoViewer } from './VideoViewer';

// Mock HTMLVideoElement.prototype.play to return a proper promise
beforeEach(() => {
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Maximize2: () => <span data-testid="maximize-icon" />,
  Minimize2: () => <span data-testid="minimize-icon" />,
  Volume2: () => <span data-testid="volume-on-icon" />,
  VolumeX: () => <span data-testid="volume-off-icon" />,
  Mic: () => <span data-testid="mic-icon" />,
}));

// Mock child components
vi.mock('./ConnectionStatus', () => ({
  ConnectionStatus: ({ connectionState }: { connectionState: string }) => (
    <div data-testid="connection-status">{connectionState}</div>
  ),
}));

vi.mock('./QualityIndicator', () => ({
  QualityIndicator: () => <div data-testid="quality-indicator" />,
}));

describe('VideoViewer', () => {
  const createMockStream = (trackKinds: ('audio' | 'video')[]): MediaStream =>
    ({
      getTracks: () => trackKinds.map((kind, i) => ({ id: `${kind}-${String(i)}`, kind })),
      getVideoTracks: () =>
        trackKinds
          .filter((kind) => kind === 'video')
          .map((kind, i) => ({ id: `${kind}-${String(i)}`, kind })),
      getAudioTracks: () =>
        trackKinds
          .filter((kind) => kind === 'audio')
          .map((kind, i) => ({ id: `${kind}-${String(i)}`, kind })),
    }) as unknown as MediaStream;

  const defaultProps = {
    stream: null,
    connectionState: 'idle' as const,
    qualityMetrics: null,
    networkQuality: 'good' as const,
    error: null,
  };

  it('renders video element', () => {
    const { container } = render(<VideoViewer {...defaultProps} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
  });

  it('renders connection status overlay', () => {
    render(<VideoViewer {...defaultProps} />);
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
  });

  it('defaults to unmuted (audio enabled by default for viewers)', () => {
    const { container } = render(<VideoViewer {...defaultProps} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    // isMuted state defaults to false — video element should not be muted
    expect(video?.getAttribute('muted')).toBeNull();
  });

  it('does not show controls overlay when not streaming', () => {
    render(<VideoViewer {...defaultProps} />);
    // Mute button title should not be present (controls only show when streaming)
    expect(screen.queryByTitle('Mute (M)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Fullscreen (F)')).not.toBeInTheDocument();
  });

  it('shows controls overlay when connected with stream', () => {
    const mockStream = createMockStream(['video']);

    render(<VideoViewer {...defaultProps} stream={mockStream} connectionState="connected" />);

    // Controls should be visible — mute button shows "Mute (M)" because default is unmuted
    expect(screen.getByTitle('Mute (M)')).toBeInTheDocument();
    expect(screen.getByTitle('Fullscreen (F)')).toBeInTheDocument();
  });

  it('shows speaker toggle in voice-only mode and toggles mute state', () => {
    const mockStream = createMockStream(['audio']);

    render(<VideoViewer {...defaultProps} stream={mockStream} connectionState="connected" />);

    const speakerButton = screen.getByTitle('Turn speaker off (M)');
    expect(speakerButton).toBeInTheDocument();

    fireEvent.click(speakerButton);

    expect(screen.getByTitle('Turn speaker on (M)')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<VideoViewer {...defaultProps} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
