import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecording, formatDuration } from './useRecording';

// Mock MediaRecorder class
class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    public options?: MediaRecorderOptions
  ) {}

  start(timeslice?: number) {
    this.state = 'recording';
    // Simulate data available after a short delay
    if (timeslice) {
      setTimeout(() => {
        this.ondataavailable?.({ data: new Blob(['test'], { type: 'video/webm' }) });
      }, timeslice);
    }
  }

  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  static isTypeSupported(mimeType: string): boolean {
    return mimeType.includes('webm');
  }
}

// Define MediaRecorder on window/global before tests run
Object.defineProperty(globalThis, 'MediaRecorder', {
  writable: true,
  configurable: true,
  value: MockMediaRecorder,
});

describe('useRecording', () => {
  let mockStream: MediaStream;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock MediaStream
    mockStream = {
      getTracks: () => [],
      getVideoTracks: () => [{ stop: vi.fn() }],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useRecording());

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.duration).toBe(0);
      expect(result.current.error).toBeNull();
    });
  });

  describe('startRecording', () => {
    it('should start recording with default options', () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        result.current.startRecording(mockStream);
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should start recording with custom quality', () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        result.current.startRecording(mockStream, { quality: '720p' });
      });

      expect(result.current.isRecording).toBe(true);
    });

    it('should return error if already recording', () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        result.current.startRecording(mockStream);
      });

      let secondResult: { success: boolean; error?: string };
      act(() => {
        secondResult = result.current.startRecording(mockStream);
      });

      expect(secondResult!.success).toBe(false);
      expect(secondResult!.error).toBe('Recording already in progress');
    });

    it('should call onStart callback', () => {
      const onStart = vi.fn();
      const { result } = renderHook(() => useRecording({ onStart }));

      act(() => {
        result.current.startRecording(mockStream);
      });

      expect(onStart).toHaveBeenCalled();
    });

    it('should update duration over time', async () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        result.current.startRecording(mockStream);
      });

      expect(result.current.duration).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(result.current.duration).toBeGreaterThanOrEqual(2);
    });
  });

  describe('pauseRecording', () => {
    it('should pause an active recording', () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        result.current.startRecording(mockStream);
      });

      act(() => {
        result.current.pauseRecording();
      });

      expect(result.current.isPaused).toBe(true);
      expect(result.current.isRecording).toBe(true);
    });

    it('should return error if not recording', () => {
      const { result } = renderHook(() => useRecording());

      let pauseResult: { success: boolean; error?: string };
      act(() => {
        pauseResult = result.current.pauseRecording();
      });

      expect(pauseResult!.success).toBe(false);
      expect(pauseResult!.error).toBe('No recording in progress');
    });

    it('should return error if already paused', () => {
      const { result } = renderHook(() => useRecording());

      // Start recording first
      act(() => {
        result.current.startRecording(mockStream);
      });

      // Pause the recording
      act(() => {
        result.current.pauseRecording();
      });

      // Try to pause again - should fail
      let secondPause: { success: boolean; error?: string };
      act(() => {
        secondPause = result.current.pauseRecording();
      });

      expect(secondPause!.success).toBe(false);
      expect(secondPause!.error).toBe('Recording already paused');
    });
  });

  describe('resumeRecording', () => {
    it('should resume a paused recording', () => {
      const { result } = renderHook(() => useRecording());

      act(() => {
        result.current.startRecording(mockStream);
        result.current.pauseRecording();
      });

      act(() => {
        result.current.resumeRecording();
      });

      expect(result.current.isPaused).toBe(false);
      expect(result.current.isRecording).toBe(true);
    });

    it('should return error if not recording', () => {
      const { result } = renderHook(() => useRecording());

      let resumeResult: { success: boolean; error?: string };
      act(() => {
        resumeResult = result.current.resumeRecording();
      });

      expect(resumeResult!.success).toBe(false);
      expect(resumeResult!.error).toBe('No recording in progress');
    });
  });

  describe('stopRecording', () => {
    it('should stop recording and call onStop', () => {
      const onStop = vi.fn();
      const { result } = renderHook(() => useRecording({ onStop }));

      act(() => {
        result.current.startRecording(mockStream);
      });

      act(() => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.duration).toBe(0);
      // onStop is called asynchronously via onstop callback
    });

    it('should return error if not recording', () => {
      const { result } = renderHook(() => useRecording());

      let stopResult: { success: boolean; error?: string };
      act(() => {
        stopResult = result.current.stopRecording();
      });

      expect(stopResult!.success).toBe(false);
      expect(stopResult!.error).toBe('No recording in progress');
    });
  });

  describe('downloadRecording', () => {
    it('should create download link for blob', () => {
      const { result } = renderHook(() => useRecording());

      const mockBlob = new Blob(['test'], { type: 'video/webm' });
      const createObjectURL = vi.fn(() => 'blob:test-url');
      const revokeObjectURL = vi.fn();
      const appendChild = vi.fn();
      const removeChild = vi.fn();
      const click = vi.fn();

      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
      vi.spyOn(document.body, 'appendChild').mockImplementation(appendChild);
      vi.spyOn(document.body, 'removeChild').mockImplementation(removeChild);
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        click,
      } as unknown as HTMLAnchorElement);

      act(() => {
        result.current.downloadRecording(mockBlob, 'test-recording.webm');
      });

      expect(createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(appendChild).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(removeChild).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });
});

describe('formatDuration', () => {
  it('should format seconds correctly', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(59)).toBe('00:59');
  });

  it('should format minutes correctly', () => {
    expect(formatDuration(60)).toBe('01:00');
    expect(formatDuration(125)).toBe('02:05');
    expect(formatDuration(599)).toBe('09:59');
  });

  it('should format hours correctly', () => {
    expect(formatDuration(3600)).toBe('01:00:00');
    expect(formatDuration(3661)).toBe('01:01:01');
    expect(formatDuration(7325)).toBe('02:02:05');
  });
});
