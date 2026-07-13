import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StreamControls } from './StreamControls';
import type { RTMPDestinationInfo } from '../../../preload/api';

const dest: RTMPDestinationInfo = {
  id: 'yt',
  name: 'YouTube',
  platform: 'youtube',
  rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  streamKeyId: 'k',
  enabled: true,
  encoderSettings: {
    videoBitrate: 3500,
    resolution: '1080p',
    framerate: 30,
    keyframeInterval: 2,
    audioBitrate: 128,
  },
};

const baseProps = {
  stream: {} as MediaStream,
  destinations: [dest],
  streamStatuses: new Map(),
  streamWarnings: new Map<string, string>(),
  isAnyStreaming: false,
  liveStreamEnabled: true,
  onStartStream: vi.fn(),
  onStopStream: vi.fn(),
  onStartAll: vi.fn().mockResolvedValue({ success: true, started: 1, errors: [] }),
  onStopAll: vi.fn().mockResolvedValue({ success: true, stopped: 1 }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StreamControls server restream', () => {
  it('offers a single "Go Live" (server/SFU) and starts it', async () => {
    const onStart = vi.fn().mockResolvedValue({ success: true });
    render(
      <StreamControls
        {...baseProps}
        serverStream={{ available: true, isStreaming: false, onStart, onStop: vi.fn() }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /go live/i }));
    await waitFor(() => {
      expect(onStart).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces server start failures inline', async () => {
    const onStart = vi.fn().mockResolvedValue({ success: false, error: 'Egress unavailable' });
    render(
      <StreamControls
        {...baseProps}
        serverStream={{ available: true, isStreaming: false, onStart, onStop: vi.fn() }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /go live/i }));
    expect(await screen.findByText('Egress unavailable')).toBeTruthy();
  });

  it('shows the server-live indicator with a working stop control', async () => {
    const onStop = vi.fn().mockResolvedValue({ success: true });
    render(
      <StreamControls
        {...baseProps}
        serverStream={{ available: true, isStreaming: true, onStart: vi.fn(), onStop }}
      />
    );

    expect(screen.getByText('Live')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Stop server stream'));
    await waitFor(() => {
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  it('hides "Go Live" when the master toggle is off', () => {
    render(
      <StreamControls
        {...baseProps}
        liveStreamEnabled={false}
        serverStream={{ available: true, isStreaming: false, onStart: vi.fn(), onStop: vi.fn() }}
      />
    );
    expect(screen.queryByRole('button', { name: /go live/i })).toBeNull();
  });
});
