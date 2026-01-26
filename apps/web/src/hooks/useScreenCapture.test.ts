import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenCapture } from './useScreenCapture';

describe('useScreenCapture', () => {
  let mockStream: MediaStream;
  let mockVideoTrack: MediaStreamTrack;
  let mockGetDisplayMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock video track
    mockVideoTrack = {
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ width: 1920, height: 1080 }),
    } as unknown as MediaStreamTrack;

    // Create mock MediaStream
    mockStream = {
      getTracks: () => [mockVideoTrack],
      getVideoTracks: () => [mockVideoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream;

    // Setup getDisplayMedia mock
    mockGetDisplayMedia = vi.fn().mockResolvedValue(mockStream);

    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getDisplayMedia: mockGetDisplayMedia,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with idle state', () => {
      const { result } = renderHook(() => useScreenCapture());

      expect(result.current.stream).toBeNull();
      expect(result.current.captureState).toBe('idle');
      expect(result.current.error).toBeNull();
    });
  });

  describe('startCapture', () => {
    it('should start capture with default quality', async () => {
      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture();
      });

      expect(result.current.captureState).toBe('active');
      expect(result.current.stream).toBe(mockStream);
      expect(result.current.error).toBeNull();

      // Should use 1080p defaults
      expect(mockGetDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
          }),
        })
      );
    });

    it('should start capture with 720p quality', async () => {
      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture({ quality: '720p' });
      });

      expect(mockGetDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
          }),
        })
      );
    });

    it('should start capture with 4k quality', async () => {
      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture({ quality: '4k' });
      });

      expect(mockGetDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 3840, max: 3840 },
            height: { ideal: 2160, max: 2160 },
          }),
        })
      );
    });

    it('should include audio when specified', async () => {
      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture({ includeAudio: true });
      });

      expect(mockGetDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({
            echoCancellation: true,
            noiseSuppression: true,
          }),
        })
      );
    });

    it('should exclude audio when specified', async () => {
      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture({ includeAudio: false });
      });

      expect(mockGetDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: false,
        })
      );
    });

    it('should call onStreamStart callback', async () => {
      const onStreamStart = vi.fn();
      const { result } = renderHook(() => useScreenCapture({ onStreamStart }));

      await act(async () => {
        await result.current.startCapture();
      });

      expect(onStreamStart).toHaveBeenCalledWith(mockStream);
    });

    it('should handle NotAllowedError', async () => {
      const error = new DOMException('Permission denied', 'NotAllowedError');
      mockGetDisplayMedia.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture();
      });

      expect(result.current.captureState).toBe('error');
      expect(result.current.error).toBe('Permission denied. Please allow screen sharing.');
    });

    it('should handle NotFoundError', async () => {
      const error = new DOMException('No screen found', 'NotFoundError');
      mockGetDisplayMedia.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture();
      });

      expect(result.current.captureState).toBe('error');
      expect(result.current.error).toBe('No screen or window available for sharing.');
    });

    it('should handle AbortError (user cancelled)', async () => {
      const error = new DOMException('User cancelled', 'AbortError');
      mockGetDisplayMedia.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useScreenCapture());

      await act(async () => {
        await result.current.startCapture();
      });

      expect(result.current.captureState).toBe('error');
      expect(result.current.error).toBe('Screen sharing was cancelled.');
    });
  });
});
