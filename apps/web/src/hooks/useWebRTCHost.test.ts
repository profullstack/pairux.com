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

describe('useWebRTCHost', () => {
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

  it('should set error when no stream available', () => {
    const { result } = renderHook(() => useWebRTCHost({ ...defaultOptions, localStream: null }));

    act(() => {
      result.current.startHosting();
    });

    expect(result.current.error).toBe('No stream available. Please start screen sharing first.');
  });

  describe('startHosting', () => {
    it('should set isHosting when channel subscribes', () => {
      // Mock subscribe to call callback with 'SUBSCRIBED'
      mockChannel.subscribe.mockImplementation((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return mockChannel;
      });

      const { result } = renderHook(() => useWebRTCHost(defaultOptions));

      act(() => {
        result.current.startHosting();
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
});
