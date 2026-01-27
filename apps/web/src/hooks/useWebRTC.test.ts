import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTC } from './useWebRTC';

// Mock Supabase client
const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn((_callback: (status: string) => void) => {
    // Don't auto-subscribe in most tests
    return mockChannel;
  }),
  send: vi.fn().mockResolvedValue(undefined),
  track: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: vi.fn(() => mockChannel),
  }),
}));

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: unknown }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null;

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'test-offer-sdp' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'test-answer-sdp' });
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
  });
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
  });
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn().mockReturnValue({
    getParameters: () => ({ encodings: [{}] }),
    setParameters: vi.fn().mockResolvedValue(undefined),
  });
  getSenders = vi.fn().mockReturnValue([]);
  getStats = vi.fn().mockResolvedValue(new Map());
  close = vi.fn();
}

// Mock MediaStream and tracks for mic
function createMockAudioTrack() {
  return {
    kind: 'audio',
    enabled: true,
    stop: vi.fn(),
    id: 'mock-audio-track',
  };
}

function createMockMicStream() {
  const audioTrack = createMockAudioTrack();
  return {
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
    getVideoTracks: () => [],
    _audioTrack: audioTrack,
  } as unknown as MediaStream & { _audioTrack: ReturnType<typeof createMockAudioTrack> };
}

describe('useWebRTC', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCIceCandidate = vi.fn((c: unknown) => c);

    mockGetUserMedia = vi.fn();
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      },
      writable: true,
      configurable: true,
    });

    // Reset channel mocks
    mockChannel.on.mockReturnThis();
    mockChannel.subscribe.mockImplementation(() => mockChannel);
    mockChannel.send.mockResolvedValue(undefined);
    mockChannel.track.mockResolvedValue(undefined);
    mockChannel.unsubscribe.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOptions = {
    sessionId: 'session-1',
    participantId: 'viewer-1',
  };

  it('should initialize with default state including mic fields', () => {
    // Don't trigger full initialization
    mockGetUserMedia.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTC(defaultOptions));

    expect(result.current.connectionState).toBe('idle');
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.micEnabled).toBe(false);
    expect(result.current.hasMic).toBe(false);
    expect(result.current.toggleMic).toBeInstanceOf(Function);
  });

  it('should export all required microphone fields', () => {
    mockGetUserMedia.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTC(defaultOptions));

    // Verify all mic-related fields are exported
    expect('micEnabled' in result.current).toBe(true);
    expect('hasMic' in result.current).toBe(true);
    expect('toggleMic' in result.current).toBe(true);
  });

  it('should export all control-related fields', () => {
    mockGetUserMedia.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTC(defaultOptions));

    expect('controlState' in result.current).toBe(true);
    expect('dataChannelReady' in result.current).toBe(true);
    expect('requestControl' in result.current).toBe(true);
    expect('releaseControl' in result.current).toBe(true);
    expect('sendInput' in result.current).toBe(true);
    expect('sendCursorPosition' in result.current).toBe(true);
  });

  describe('microphone capture', () => {
    it('should set hasMic=true and micEnabled=true on successful mic capture', async () => {
      const mockStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the getUserMedia promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.hasMic).toBe(true);
      expect(hookResult!.current.micEnabled).toBe(true);
      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    });

    it('should gracefully handle mic permission denied', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the rejected promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.hasMic).toBe(false);
      expect(hookResult!.current.micEnabled).toBe(false);
      // Should not set an error for mic permission denial
      expect(hookResult!.current.error).toBeNull();
    });
  });

  describe('toggleMic', () => {
    it('should toggle mic track enabled state', async () => {
      const mockStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the getUserMedia promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.micEnabled).toBe(true);

      // Toggle off
      act(() => {
        hookResult!.current.toggleMic();
      });

      expect(hookResult!.current.micEnabled).toBe(false);
      expect(mockStream._audioTrack.enabled).toBe(false);

      // Toggle back on
      act(() => {
        hookResult!.current.toggleMic();
      });

      expect(hookResult!.current.micEnabled).toBe(true);
      expect(mockStream._audioTrack.enabled).toBe(true);
    });

    it('should be no-op when no mic stream exists', () => {
      mockGetUserMedia.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useWebRTC(defaultOptions));

      // Should not throw
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should reset mic state on disconnect', async () => {
      const mockStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      let hookResult: { current: ReturnType<typeof useWebRTC> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTC(defaultOptions));
        hookResult = result;
        // Flush the getUserMedia promise chain
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hookResult!.current.micEnabled).toBe(true);

      act(() => {
        hookResult!.current.disconnect();
      });

      expect(hookResult!.current.micEnabled).toBe(false);
      expect(hookResult!.current.hasMic).toBe(false);
      expect(hookResult!.current.connectionState).toBe('disconnected');
      // Mic tracks should be stopped
      expect(mockStream._audioTrack.stop).toHaveBeenCalled();
    });
  });
});
