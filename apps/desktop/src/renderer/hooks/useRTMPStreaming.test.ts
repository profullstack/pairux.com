import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRTMPStreaming, formatDuration } from './useRTMPStreaming';

// Mock MediaRecorder
class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  state = 'inactive';

  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
}

// Mock MediaStream (not available in jsdom)
class MockMediaStream {
  id = 'mock-stream';
  active = true;
  getAudioTracks = vi.fn(() => []);
  getVideoTracks = vi.fn(() => []);
  getTracks = vi.fn(() => []);
}

// Mock electron API
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(() => vi.fn()),
  off: vi.fn(),
};

const mockDestinations = [
  {
    id: 'dest-1',
    name: 'YouTube',
    platform: 'youtube' as const,
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKeyId: 'key-1',
    enabled: true,
    encoderSettings: {
      videoBitrate: 4500,
      resolution: '1080p' as const,
      framerate: 30 as const,
      keyframeInterval: 2,
      audioBitrate: 128,
    },
  },
  {
    id: 'dest-2',
    name: 'Twitch',
    platform: 'twitch' as const,
    rtmpUrl: 'rtmp://live.twitch.tv/app',
    streamKeyId: 'key-2',
    enabled: true,
    encoderSettings: {
      videoBitrate: 6000,
      resolution: '1080p' as const,
      framerate: 60 as const,
      keyframeInterval: 2,
      audioBitrate: 128,
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();

  (
    window as unknown as {
      electronAPI: typeof mockElectronAPI;
    }
  ).electronAPI = mockElectronAPI;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).MediaRecorder = MockMediaRecorder;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).MediaStream = MockMediaStream;

  // Default mock implementations
  mockElectronAPI.invoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'rtmp:getDestinations':
        return Promise.resolve(mockDestinations);
      case 'rtmp:addDestination':
        return Promise.resolve({
          id: 'dest-3',
          name: 'Custom',
          platform: 'custom',
          rtmpUrl: 'rtmp://custom.example.com/live',
          streamKeyId: 'key-3',
          enabled: true,
          encoderSettings: {
            videoBitrate: 4500,
            resolution: '1080p',
            framerate: 30,
            keyframeInterval: 2,
            audioBitrate: 128,
          },
        });
      case 'rtmp:updateDestination':
        return Promise.resolve({ ...mockDestinations[0], name: 'Updated YouTube' });
      case 'rtmp:removeDestination':
        return Promise.resolve(true);
      case 'rtmp:startStream':
        return Promise.resolve({ success: true });
      case 'rtmp:stopStream':
        return Promise.resolve({ success: true });
      case 'rtmp:startAll':
        return Promise.resolve({ success: true, started: 2, errors: [] });
      case 'rtmp:stopAll':
        return Promise.resolve({ success: true, stopped: 2 });
      case 'rtmp:getStatus':
        return Promise.resolve([]);
      case 'rtmp:writeChunk':
        return Promise.resolve();
      default:
        return Promise.resolve({});
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRTMPStreaming', () => {
  describe('initialization', () => {
    it('should load destinations on mount', async () => {
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:getDestinations', undefined);
      expect(result.current.destinations).toEqual(mockDestinations);
      expect(result.current.isLoading).toBe(false);
    });

    it('should initialize with no active streams', async () => {
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isAnyStreaming).toBe(false);
      expect(result.current.activeStreamCount).toBe(0);
      expect(result.current.streamStatuses.size).toBe(0);
    });

    it('should handle destination loading errors', async () => {
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'rtmp:getDestinations') {
          return Promise.reject(new Error('Storage error'));
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.error).toBe('Failed to load streaming destinations');
      expect(result.current.isLoading).toBe(false);
    });

    it('should subscribe to status change and error events', () => {
      renderHook(() => useRTMPStreaming());

      expect(mockElectronAPI.on).toHaveBeenCalledWith(
        'rtmp:streamStatusChanged',
        expect.any(Function)
      );
      expect(mockElectronAPI.on).toHaveBeenCalledWith('rtmp:streamError', expect.any(Function));
    });
  });

  describe('destination management', () => {
    it('should add a destination', async () => {
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        await result.current.addDestination(
          {
            name: 'Custom',
            platform: 'custom',
            rtmpUrl: 'rtmp://custom.example.com/live',
            enabled: true,
            encoderSettings: {
              videoBitrate: 4500,
              resolution: '1080p',
              framerate: 30,
              keyframeInterval: 2,
              audioBitrate: 128,
            },
          },
          'my-stream-key'
        );
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:addDestination', {
        destination: expect.objectContaining({ name: 'Custom' }),
        streamKey: 'my-stream-key',
      });
      expect(result.current.destinations).toHaveLength(3);
    });

    it('should update a destination', async () => {
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        await result.current.updateDestination('dest-1', { name: 'Updated YouTube' });
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:updateDestination', {
        id: 'dest-1',
        updates: { name: 'Updated YouTube' },
        newStreamKey: undefined,
      });
      expect(result.current.destinations[0].name).toBe('Updated YouTube');
    });

    it('should remove a destination', async () => {
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        await result.current.removeDestination('dest-1');
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:removeDestination', {
        id: 'dest-1',
      });
      expect(result.current.destinations).toHaveLength(1);
      expect(result.current.destinations[0].id).toBe('dest-2');
    });
  });

  describe('stream control', () => {
    it('should start a single stream', async () => {
      const onStreamStarted = vi.fn();
      const mockStream = new MediaStream();
      const { result } = renderHook(() => useRTMPStreaming({ onStreamStarted }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        const response = await result.current.startStream('dest-1', mockStream);
        expect(response.success).toBe(true);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:startStream', {
        destinationId: 'dest-1',
      });
      expect(onStreamStarted).toHaveBeenCalledWith('dest-1');
    });

    it('should stop a single stream', async () => {
      const onStreamStopped = vi.fn();
      const mockStream = new MediaStream();
      const { result } = renderHook(() => useRTMPStreaming({ onStreamStopped }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Start first
      await act(async () => {
        await result.current.startStream('dest-1', mockStream);
      });

      await act(async () => {
        const response = await result.current.stopStream('dest-1');
        expect(response.success).toBe(true);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:stopStream', {
        destinationId: 'dest-1',
      });
      expect(onStreamStopped).toHaveBeenCalledWith('dest-1');
    });

    it('should start all streams', async () => {
      const mockStream = new MediaStream();
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        const response = await result.current.startAllStreams(mockStream);
        expect(response.success).toBe(true);
        expect(response.started).toBe(2);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:startAll', undefined);
    });

    it('should stop all streams', async () => {
      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        const response = await result.current.stopAllStreams();
        expect(response.success).toBe(true);
        expect(response.stopped).toBe(2);
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('rtmp:stopAll', undefined);
    });
  });

  describe('event handling', () => {
    it('should update stream status on status change event', async () => {
      let statusHandler: ((data: unknown) => void) | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockElectronAPI.on as any).mockImplementation(
        (channel: string, handler: (data: unknown) => void) => {
          if (channel === 'rtmp:streamStatusChanged') {
            statusHandler = handler;
          }
          return vi.fn();
        }
      );

      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Simulate status change event
      act(() => {
        statusHandler?.({
          destinationId: 'dest-1',
          status: 'live',
        });
      });

      expect(result.current.streamStatuses.get('dest-1')).toMatchObject({
        destinationId: 'dest-1',
        status: 'live',
      });
    });

    it('should call onStreamError when error event received', async () => {
      const onStreamError = vi.fn();
      let errorHandler: ((data: unknown) => void) | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockElectronAPI.on as any).mockImplementation(
        (channel: string, handler: (data: unknown) => void) => {
          if (channel === 'rtmp:streamError') {
            errorHandler = handler;
          }
          return vi.fn();
        }
      );

      renderHook(() => useRTMPStreaming({ onStreamError }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      act(() => {
        errorHandler?.({ destinationId: 'dest-1', error: 'Connection refused' });
      });

      expect(onStreamError).toHaveBeenCalledWith('dest-1', 'Connection refused');
    });

    it('should call onStatusChanged callback', async () => {
      const onStatusChanged = vi.fn();
      let statusHandler: ((data: unknown) => void) | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockElectronAPI.on as any).mockImplementation(
        (channel: string, handler: (data: unknown) => void) => {
          if (channel === 'rtmp:streamStatusChanged') {
            statusHandler = handler;
          }
          return vi.fn();
        }
      );

      renderHook(() => useRTMPStreaming({ onStatusChanged }));

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      act(() => {
        statusHandler?.({ destinationId: 'dest-1', status: 'connecting' });
      });

      expect(onStatusChanged).toHaveBeenCalledWith('dest-1', 'connecting');
    });
  });

  describe('computed state', () => {
    it('should count active streams', async () => {
      let statusHandler: ((data: unknown) => void) | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockElectronAPI.on as any).mockImplementation(
        (channel: string, handler: (data: unknown) => void) => {
          if (channel === 'rtmp:streamStatusChanged') {
            statusHandler = handler;
          }
          return vi.fn();
        }
      );

      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Add two live streams
      act(() => {
        statusHandler?.({ destinationId: 'dest-1', status: 'live' });
      });

      act(() => {
        statusHandler?.({ destinationId: 'dest-2', status: 'live' });
      });

      expect(result.current.activeStreamCount).toBe(2);
      expect(result.current.isAnyStreaming).toBe(true);
    });

    it('should not count non-live streams as active', async () => {
      let statusHandler: ((data: unknown) => void) | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockElectronAPI.on as any).mockImplementation(
        (channel: string, handler: (data: unknown) => void) => {
          if (channel === 'rtmp:streamStatusChanged') {
            statusHandler = handler;
          }
          return vi.fn();
        }
      );

      const { result } = renderHook(() => useRTMPStreaming());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      act(() => {
        statusHandler?.({ destinationId: 'dest-1', status: 'connecting' });
      });

      act(() => {
        statusHandler?.({ destinationId: 'dest-2', status: 'error' });
      });

      expect(result.current.activeStreamCount).toBe(0);
      expect(result.current.isAnyStreaming).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should unsubscribe from events on unmount', () => {
      const unsubStatus = vi.fn();
      const unsubError = vi.fn();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockElectronAPI.on as any).mockImplementation((channel: string) => {
        if (channel === 'rtmp:streamStatusChanged') return unsubStatus;
        if (channel === 'rtmp:streamError') return unsubError;
        return vi.fn();
      });

      const { unmount } = renderHook(() => useRTMPStreaming());

      unmount();

      expect(unsubStatus).toHaveBeenCalled();
      expect(unsubError).toHaveBeenCalled();
    });
  });
});

describe('formatDuration', () => {
  it('should format seconds to MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(59)).toBe('00:59');
    expect(formatDuration(60)).toBe('01:00');
    expect(formatDuration(125)).toBe('02:05');
  });

  it('should format to HH:MM:SS for durations over an hour', () => {
    expect(formatDuration(3600)).toBe('01:00:00');
    expect(formatDuration(3661)).toBe('01:01:01');
    expect(formatDuration(7325)).toBe('02:02:05');
  });
});
