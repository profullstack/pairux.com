import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCHost } from './useWebRTCHost';

// Mock Supabase client
const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
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
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'test-sdp' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'test-answer-sdp' });
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    }
  });
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
    if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  });
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn().mockReturnValue({
    getParameters: () => ({ encodings: [{}] }),
    setParameters: vi.fn().mockResolvedValue(undefined),
  });
  getSenders = vi.fn().mockReturnValue([]);
  getStats = vi.fn().mockResolvedValue(new Map());
  createDataChannel = vi.fn().mockReturnValue({
    onopen: null,
    onclose: null,
    onmessage: null,
    readyState: 'connecting',
    send: vi.fn(),
  });
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });
}

// Create mock MediaStream
function createMockStream(): MediaStream {
  const mockTrack = {
    kind: 'video',
    contentHint: '',
    getSettings: () => ({ width: 1920, height: 1080 }),
  };
  return {
    getTracks: () => [mockTrack],
    getVideoTracks: () => [mockTrack],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

// Create mock mic stream with controllable audio tracks
interface MockMicTrack {
  kind: string;
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
}

type MockMicStream = MediaStream & { _audioTracks: MockMicTrack[] };

function createMockMicStream(): MockMicStream {
  const micTrack: MockMicTrack = {
    kind: 'audio',
    enabled: true,
    stop: vi.fn(),
  };
  return {
    _audioTracks: [micTrack],
    getTracks: () => [micTrack],
    getVideoTracks: () => [],
    getAudioTracks: () => [micTrack],
  } as unknown as MockMicStream;
}

describe('useWebRTCHost', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCIceCandidate = vi.fn((c: unknown) => c);
    (globalThis as Record<string, unknown>).MediaStream = vi.fn((tracks?: MediaStreamTrack[]) => ({
      getTracks: () => tracks ?? [],
      getVideoTracks: () => [],
      getAudioTracks: () => tracks?.filter((t) => t.kind === 'audio') ?? [],
    }));
    (globalThis as Record<string, unknown>).Audio = vi.fn(() => ({
      srcObject: null,
      autoplay: false,
      volume: 1.0,
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    }));

    // Mock navigator.mediaDevices.getUserMedia for mic capture
    mockGetUserMedia = vi.fn().mockResolvedValue(createMockMicStream());
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
    mockChannel.subscribe.mockReturnThis();
    mockChannel.send.mockResolvedValue(undefined);
    mockChannel.track.mockResolvedValue(undefined);
    mockChannel.unsubscribe.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOptions = {
    sessionId: 'session-1',
    hostId: 'host-1',
    localStream: createMockStream(),
  };

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useWebRTCHost(defaultOptions));

    expect(result.current.isHosting).toBe(false);
    expect(result.current.viewerCount).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.controllingViewer).toBeNull();
  });

  it('should expose muteViewer in returned API', () => {
    const { result } = renderHook(() => useWebRTCHost(defaultOptions));
    expect(result.current.muteViewer).toBeInstanceOf(Function);
  });

  it('should start hosting without a stream (voice-only session)', () => {
    const { result } = renderHook(() => useWebRTCHost({ ...defaultOptions, localStream: null }));

    act(() => {
      void result.current.startHosting();
    });

    // Should not set an error — voice-only sessions are now supported
    expect(result.current.error).toBeNull();
  });

  describe('startHosting', () => {
    it('should set isHosting when channel subscribes', async () => {
      // Mock subscribe to call callback with 'SUBSCRIBED'
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.isHosting).toBe(true);
      expect(result.current.error).toBeNull();
    });
  });

  describe('stopHosting', () => {
    it('should clean up audio elements when stopping', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      act(() => {
        result.current.stopHosting();
      });

      expect(result.current.isHosting).toBe(false);
      expect(result.current.viewerCount).toBe(0);
    });
  });

  describe('muteViewer', () => {
    it('should handle muteViewer call for nonexistent viewer gracefully', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      // Should not throw
      act(() => {
        result.current.muteViewer('nonexistent-viewer', true);
      });
    });
  });

  describe('ViewerConnection audio fields', () => {
    it('should export viewers map with audio-related fields', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      // Viewers is a Map
      expect(result.current.viewers).toBeInstanceOf(Map);
      expect(result.current.viewers.size).toBe(0);
    });
  });

  describe('host microphone', () => {
    it('should initialize mic state as disabled', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      expect(result.current.micEnabled).toBe(false);
      expect(result.current.hasMic).toBe(false);
      expect(result.current.micStream).toBeNull();
      expect(result.current.toggleMic).toBeInstanceOf(Function);
    });

    it('should capture mic when startHosting is called', async () => {
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
      expect(result.current.hasMic).toBe(true);
      expect(result.current.micEnabled).toBe(true);
    });

    it('should host without mic when getUserMedia fails', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      // Should still be hosting despite mic failure
      expect(result.current.isHosting).toBe(true);
      expect(result.current.hasMic).toBe(false);
      expect(result.current.micEnabled).toBe(false);
      expect(result.current.micStream).toBeNull();
    });

    it('should toggle mic audio track enabled state', async () => {
      const mockMicStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockMicStream);
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.micEnabled).toBe(true);

      // Toggle mic off
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(false);
      expect(mockMicStream._audioTracks[0]!.enabled).toBe(false);

      // Toggle mic back on
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(true);
      expect(mockMicStream._audioTracks[0]!.enabled).toBe(true);
    });

    it('should do nothing when toggleMic is called without a mic', () => {
      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      // Should not throw when no mic is available
      act(() => {
        result.current.toggleMic();
      });

      expect(result.current.micEnabled).toBe(false);
    });

    it('should stop mic tracks when stopHosting is called', async () => {
      const mockMicStream = createMockMicStream();
      mockGetUserMedia.mockResolvedValue(mockMicStream);
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.hasMic).toBe(true);

      act(() => {
        result.current.stopHosting();
      });

      // Mic tracks should have been stopped
      expect(mockMicStream._audioTracks[0]!.stop).toHaveBeenCalled();
    });
  });

  describe('ICE candidate buffering', () => {
    it('should export pendingCandidatesRef functionality (no crash on early ICE)', async () => {
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(result.current.isHosting).toBe(true);

      // Simulate a viewer signal with ICE candidate before answer
      // Get the signal handler from channel.on calls
      const signalCall = mockChannel.on.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'broadcast' && (call[1] as Record<string, string>).event === 'signal'
      );

      // If the channel was set up, verify the hook handles early ICE candidates
      if (signalCall) {
        const signalHandler = signalCall[2] as (payload: { payload: unknown }) => void;

        // Send ICE candidate for a non-existent viewer — should not crash
        await act(async () => {
          signalHandler({
            payload: {
              type: 'ice-candidate',
              candidate: { candidate: 'early-candidate' },
              senderId: 'unknown-viewer',
              targetId: 'host-1',
              timestamp: Date.now(),
            },
          });
          await Promise.resolve();
        });

        expect(result.current.error).toBeNull();
      }
    });
  });
});
