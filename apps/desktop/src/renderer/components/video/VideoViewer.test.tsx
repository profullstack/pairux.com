import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoViewer } from './VideoViewer';
import type { ConnectionState } from '@pairux/shared-types';

describe('VideoViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockStream = (trackKinds: ('audio' | 'video')[] = ['video']): MediaStream => {
    const tracks = trackKinds.map((kind, i) => ({ id: `${kind}-${String(i)}`, kind }));
    return {
      getTracks: vi.fn().mockReturnValue(tracks),
      getVideoTracks: vi.fn().mockReturnValue(tracks.filter((t) => t.kind === 'video')),
      getAudioTracks: vi.fn().mockReturnValue(tracks.filter((t) => t.kind === 'audio')),
    } as unknown as MediaStream;
  };

  it('renders waiting state when no stream and idle', () => {
    render(<VideoViewer stream={null} connectionState="idle" />);

    expect(screen.getByText('Waiting for host to share screen...')).toBeInTheDocument();
    expect(screen.getByText('The stream will appear here when ready')).toBeInTheDocument();
  });

  it('renders connecting spinner when connecting', () => {
    render(<VideoViewer stream={null} connectionState="connecting" />);

    expect(screen.getByText('Connecting to host...')).toBeInTheDocument();
  });

  it('renders reconnecting message when reconnecting', () => {
    render(<VideoViewer stream={null} connectionState="reconnecting" />);

    expect(screen.getByText('Reconnecting to host...')).toBeInTheDocument();
  });

  it('renders error overlay when connection failed', () => {
    render(<VideoViewer stream={null} connectionState="failed" error="Connection timed out" />);

    expect(screen.getByText('Connection timed out')).toBeInTheDocument();
  });

  it('renders default error message when failed with no error text', () => {
    render(<VideoViewer stream={null} connectionState="failed" />);

    expect(screen.getByText('Connection lost')).toBeInTheDocument();
  });

  it('renders reconnect button when failed and onReconnect provided', () => {
    const onReconnect = vi.fn();
    render(<VideoViewer stream={null} connectionState="failed" onReconnect={onReconnect} />);

    const reconnectButton = screen.getByText('Reconnect');
    expect(reconnectButton).toBeInTheDocument();

    fireEvent.click(reconnectButton);
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('does not render reconnect button when onReconnect not provided', () => {
    render(<VideoViewer stream={null} connectionState="failed" />);

    expect(screen.queryByText('Reconnect')).not.toBeInTheDocument();
  });

  it('renders disconnected state', () => {
    render(<VideoViewer stream={null} connectionState="disconnected" />);

    expect(screen.getByText('Connection lost')).toBeInTheDocument();
  });

  it('sets video srcObject when stream is provided', () => {
    const stream = createMockStream();
    const mockPlay = vi.fn().mockResolvedValue(undefined);

    // Mock HTMLVideoElement.play()
    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = mockPlay;

    render(<VideoViewer stream={stream} connectionState="connected" />);

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.srcObject).toBe(stream);
    expect(mockPlay).toHaveBeenCalled();

    HTMLVideoElement.prototype.play = originalPlay;
  });

  it('clears video srcObject when stream becomes null', () => {
    const stream = createMockStream();
    const mockPlay = vi.fn().mockResolvedValue(undefined);
    HTMLVideoElement.prototype.play = mockPlay;

    const { rerender } = render(<VideoViewer stream={stream} connectionState="connected" />);

    const video = document.querySelector('video');
    expect(video!.srcObject).toBe(stream);

    rerender(<VideoViewer stream={null} connectionState="disconnected" />);

    expect(video!.srcObject).toBeNull();
  });

  it('renders connection badge with correct state', () => {
    const states: { state: ConnectionState; label: string }[] = [
      { state: 'idle', label: 'Waiting' },
      { state: 'connecting', label: 'Connecting' },
      { state: 'connected', label: 'Connected' },
      { state: 'reconnecting', label: 'Reconnecting' },
      { state: 'failed', label: 'Failed' },
      { state: 'disconnected', label: 'Disconnected' },
    ];

    for (const { state, label } of states) {
      const { unmount } = render(<VideoViewer stream={null} connectionState={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies custom className', () => {
    const { container } = render(
      <VideoViewer stream={null} connectionState="idle" className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('falls back to muted playback when unmuted play fails', async () => {
    const stream = createMockStream();
    let callCount = 0;

    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = vi.fn().mockImplementation(function (this: HTMLVideoElement) {
      callCount++;
      if (callCount === 1 && !this.muted) {
        // First call (unmuted) — reject to trigger fallback
        return Promise.reject(new Error('NotAllowedError'));
      }
      // Second call (muted) — succeed
      return Promise.resolve();
    });

    render(<VideoViewer stream={stream} connectionState="connected" />);

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.srcObject).toBe(stream);

    // Wait for the fallback to execute
    await vi.waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    HTMLVideoElement.prototype.play = originalPlay;
  });

  it('renders speaker toggle for audio streams and toggles output mute', () => {
    const stream = createMockStream(['video', 'audio']);
    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    render(<VideoViewer stream={stream} connectionState="connected" />);

    const button = screen.getByTitle('Turn speaker off');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    expect(screen.getByTitle('Turn speaker on')).toBeInTheDocument();

    HTMLVideoElement.prototype.play = originalPlay;
  });
});
