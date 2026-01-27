import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    const mockStream = {
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    } as unknown as MediaStream;

    render(<VideoViewer {...defaultProps} stream={mockStream} connectionState="connected" />);

    // Controls should be visible — mute button shows "Mute (M)" because default is unmuted
    expect(screen.getByTitle('Mute (M)')).toBeInTheDocument();
    expect(screen.getByTitle('Fullscreen (F)')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<VideoViewer {...defaultProps} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
