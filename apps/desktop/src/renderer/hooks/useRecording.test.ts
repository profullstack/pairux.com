import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecording, formatDuration } from './useRecording';

// Mock MediaRecorder
class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  state = 'inactive';

  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.onstop?.();
  });
  pause = vi.fn(() => {
    this.state = 'paused';
  });
  resume = vi.fn(() => {
    this.state = 'recording';
  });
}

// Mock MediaStream
class MockMediaStream {
  getTracks = vi.fn(() => [{ stop: vi.fn() }]);
}

// Mock navigator.mediaDevices
const mockGetUserMedia = vi.fn();

// Mock electron API
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
};

// Setup globals
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();

  // Setup window mocks
  (
    window as unknown as {
      electronAPI: typeof mockElectronAPI;
    }
  ).electronAPI = mockElectronAPI;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).MediaRecorder = MockMediaRecorder;

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
  });

  // Default mock implementations
  mockGetUserMedia.mockResolvedValue(new MockMediaStream());
  mockElectronAPI.invoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'recording:start':
        return Promise.resolve({ success: true, path: '/test/recording.webm' });
      case 'recording:stop':
        return Promise.resolve({ success: true, path: '/test/recording.webm', duration: 10000 });
      case 'recording:pause':
        return Promise.resolve({ success: true });
      case 'recording:resume':
        return Promise.resolve({ success: true });
      case 'recording:writeChunk':
        return Promise.resolve({ success: true });
      case 'recording:getDirectory':
        return Promise.resolve({ path: '/test/recordings' });
      case 'recording:showSaveDialog':
        return Promise.resolve({ path: '/test/custom.webm' });
      case 'recording:openFolder':
        return Promise.resolve({ success: true });
      case 'recording:getAvailableSpace':
        return Promise.resolve({ bytes: 10_000_000_000, gb: 10 });
      default:
        return Promise.resolve({});
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRecording', () => {
  describe('initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useRecording());

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.duration).toBe(0);
      expect(result.current.path).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('startRecording', () => {
    it('should start recording successfully', async () => {
      const onStart = vi.fn();
      const { result } = renderHook(() => useRecording({ onStart }));

      await act(async () => {
        const response = await result.current.startRecording('source-123');
        expect(response.success).toBe(true);
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.path).toBe('/test/recording.webm');
      expect(onStart).toHaveBeenCalledWith('/test/recording.webm');
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('recording:start', {
        customPath: undefined,
        format: 'webm',
      });
    });

    it('should use custom quality settings', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123', {
          quality: '720p',
          format: 'mp4',
          includeAudio: true,
        });
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('recording:start', {
        customPath: undefined,
        format: 'mp4',
      });
    });

    it('should fail if already recording', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      await act(async () => {
        const response = await result.current.startRecording('source-123');
        expect(response.success).toBe(false);
        expect(response.error).toBe('Recording already in progress');
      });
    });

    it('should handle start failures', async () => {
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'recording:start') {
          return Promise.resolve({ success: false, error: 'Disk full' });
        }
        return Promise.resolve({});
      });

      const onError = vi.fn();
      const { result } = renderHook(() => useRecording({ onError }));

      await act(async () => {
        const response = await result.current.startRecording('source-123');
        expect(response.success).toBe(false);
        expect(response.error).toBe('Disk full');
      });

      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('stopRecording', () => {
    it('should stop recording successfully', async () => {
      const onStop = vi.fn();
      const { result } = renderHook(() => useRecording({ onStop }));

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      await act(async () => {
        const response = await result.current.stopRecording();
        expect(response.success).toBe(true);
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.path).toBeNull();
      expect(onStop).toHaveBeenCalled();
    });

    it('should fail if not recording', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        const response = await result.current.stopRecording();
        expect(response.success).toBe(false);
        expect(response.error).toBe('No recording in progress');
      });
    });
  });

  describe('pauseRecording', () => {
    it('should pause recording successfully', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      await act(async () => {
        const response = await result.current.pauseRecording();
        expect(response.success).toBe(true);
      });

      expect(result.current.isPaused).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('recording:pause');
    });

    it('should fail if not recording', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        const response = await result.current.pauseRecording();
        expect(response.success).toBe(false);
      });
    });

    it('should fail if already paused', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      await act(async () => {
        await result.current.pauseRecording();
      });

      await act(async () => {
        const response = await result.current.pauseRecording();
        expect(response.success).toBe(false);
        expect(response.error).toBe('Recording already paused');
      });
    });
  });

  describe('resumeRecording', () => {
    it('should resume recording successfully', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      await act(async () => {
        await result.current.pauseRecording();
      });

      await act(async () => {
        const response = await result.current.resumeRecording();
        expect(response.success).toBe(true);
      });

      expect(result.current.isPaused).toBe(false);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('recording:resume');
    });

    it('should fail if not paused', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      await act(async () => {
        const response = await result.current.resumeRecording();
        expect(response.success).toBe(false);
        expect(response.error).toBe('Recording is not paused');
      });
    });
  });

  describe('utility functions', () => {
    it('should get recordings directory', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        const dir = await result.current.getRecordingsDirectory();
        expect(dir).toBe('/test/recordings');
      });
    });

    it('should show save dialog', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        const path = await result.current.showSaveDialog();
        expect(path).toBe('/test/custom.webm');
      });
    });

    it('should get available space', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        const space = await result.current.getAvailableSpace();
        expect(space?.gb).toBe(10);
      });
    });

    it('should open recordings folder', async () => {
      const { result } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.openRecordingsFolder();
      });

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('recording:openFolder');
    });
  });

  describe('space warning', () => {
    it('should trigger space warning when low on space', async () => {
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        if (channel === 'recording:getAvailableSpace') {
          return Promise.resolve({ bytes: 100_000_000, gb: 0.1 }); // 100MB - below 500MB threshold
        }
        if (channel === 'recording:start') {
          return Promise.resolve({ success: true, path: '/test/recording.webm' });
        }
        return Promise.resolve({});
      });

      const onSpaceWarning = vi.fn();
      const { result } = renderHook(() => useRecording({ onSpaceWarning }));

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      // Wait for space check
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onSpaceWarning).toHaveBeenCalledWith(0.1);
    });
  });

  describe('cleanup', () => {
    it('should stop recording on unmount', async () => {
      const stopSpy = vi.fn();

      // Override the stop method to use our spy
      class TestMediaRecorder extends MockMediaRecorder {
        override stop = stopSpy;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).MediaRecorder = TestMediaRecorder;

      const { result, unmount } = renderHook(() => useRecording());

      await act(async () => {
        await result.current.startRecording('source-123');
      });

      expect(result.current.isRecording).toBe(true);

      unmount();

      // MediaRecorder.stop should have been called
      expect(stopSpy).toHaveBeenCalled();
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
