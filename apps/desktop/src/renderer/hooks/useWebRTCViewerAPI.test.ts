import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCViewerAPI } from './useWebRTCViewerAPI';

// Mock modules
vi.mock('../../shared/config', () => ({
  API_BASE_URL: 'http://localhost:3000',
  APP_URL: 'https://pairux.com',
}));

vi.mock('@/lib/ipc', () => ({
  getElectronAPI: () => ({
    invoke: vi.fn().mockResolvedValue({ token: 'test-token' }),
  }),
}));

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  close = vi.fn(() => {
    this.readyState = 2;
  });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener() {
    // no-op for tests
  }

  emit(type: string, data: unknown) {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
    }
  }
}

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];
  connectionState = 'new';
  iceConnectionState = 'new';
  signalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;

  ontrack: ((event: unknown) => void) | null = null;
  onicecandidate: ((event: unknown) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: unknown) => void) | null = null;

  addTrack = vi.fn();
  close = vi.fn();
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp-answer' });
  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp-offer' });
  setLocalDescription = vi.fn().mockResolvedValue(undefined);
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
  });
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  getStats = vi.fn().mockResolvedValue(new Map());

  constructor() {
    MockRTCPeerConnection.instances.push(this);
  }
}

// Mock RTCIceCandidate
class MockRTCIceCandidate {
  candidate: string;
  constructor(init: { candidate: string }) {
    this.candidate = init.candidate;
  }
}

// Mock fetch
const mockFetch = vi.fn();

// Mock getUserMedia
const mockAudioTrack = {
  kind: 'audio',
  enabled: true,
  stop: vi.fn(),
  id: 'audio-track-1',
};

const mockMicStream = {
  getTracks: vi.fn(),
  getAudioTracks: vi.fn(),
  getVideoTracks: vi.fn(),
} as unknown as MediaStream;

// Connected event data with ICE servers
const connectedEventData = JSON.stringify({
  sessionId: 'session-1',
  subscriberId: 'viewer-1',
  isHost: false,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
});

describe('useWebRTCViewerAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    MockRTCPeerConnection.instances = [];

    // Re-set mock implementations (vi.restoreAllMocks clears them)
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    });
    mockAudioTrack.stop = vi.fn();
    mockAudioTrack.enabled = true;
    (mockMicStream.getTracks as ReturnType<typeof vi.fn>).mockReturnValue([mockAudioTrack]);
    (mockMicStream.getAudioTracks as ReturnType<typeof vi.fn>).mockReturnValue([mockAudioTrack]);
    (mockMicStream.getVideoTracks as ReturnType<typeof vi.fn>).mockReturnValue([]);

    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCIceCandidate = MockRTCIceCandidate;
    (globalThis as Record<string, unknown>).fetch = mockFetch;

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockMicStream),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {});

  const defaultOptions = {
    sessionId: 'session-1',
    participantId: 'viewer-1',
  };

  /**
   * Helper: initialize hook, wait for SSE, emit connected event to create PC.
   * Returns { hookResult, es, pc }.
   */
  async function initWithConnected(
    options: Parameters<typeof useWebRTCViewerAPI>[0] = defaultOptions
  ) {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerAPI(options));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const es = MockEventSource.instances[0];

    // Emit the connected event to trigger PC creation
    act(() => {
      es.emit('connected', connectedEventData);
    });

    const pc = MockRTCPeerConnection.instances[0];

    return { hookResult: hookResult!, es, pc };
  }

  it('should initialize with default state', () => {
    // Prevent initialization from running by mocking navigator to hang
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockReturnValue(new Promise(() => {})),
        },
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useWebRTCViewerAPI(defaultOptions));

    expect(result.current.connectionState).toBe('idle');
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.controlState).toBe('view-only');
    expect(result.current.dataChannelReady).toBe(false);
    expect(result.current.micEnabled).toBe(false);
    expect(result.current.hasMic).toBe(false);
  });

  it('should connect to SSE stream on initialize', async () => {
    await act(async () => {
      renderHook(() => useWebRTCViewerAPI(defaultOptions));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0];
    expect(es.url).toContain('/api/sessions/session-1/signal/stream');
    expect(es.url).toContain('participantId=viewer-1');
    expect(es.url).toContain('token=test-token');
  });

  it('should create RTCPeerConnection on SSE connected event', async () => {
    const { pc } = await initWithConnected();
    expect(MockRTCPeerConnection.instances).toHaveLength(1);
    expect(pc).toBeDefined();
  });

  it('should add mic tracks to peer connection after connected event', async () => {
    const { pc } = await initWithConnected();
    expect(pc.addTrack).toHaveBeenCalledWith(mockAudioTrack, mockMicStream);
  });

  it('should set hasMic and micEnabled on successful mic capture', async () => {
    const { hookResult } = await initWithConnected();

    expect(hookResult.current.hasMic).toBe(true);
    expect(hookResult.current.micEnabled).toBe(true);
  });

  it('should handle mic unavailable gracefully', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new Error('No mic')),
        },
      },
      writable: true,
      configurable: true,
    });

    let hookResult: { current: ReturnType<typeof useWebRTCViewerAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hookResult!.current.hasMic).toBe(false);
    expect(hookResult!.current.micEnabled).toBe(false);
  });

  it('should handle offer signal by creating answer', async () => {
    const { es, pc } = await initWithConnected();

    // Simulate receiving an offer from host
    await act(async () => {
      es.emit('signal', {
        type: 'offer',
        sdp: 'mock-sdp-offer',
        senderId: 'host-1',
        timestamp: Date.now(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: 'offer',
      sdp: 'mock-sdp-offer',
    });
    expect(pc.createAnswer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalled();

    // Should POST answer back via API
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/session-1/signal',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"type":"answer"'),
      })
    );
  });

  it('should handle ICE candidate signal after offer', async () => {
    const { es, pc } = await initWithConnected();

    // First send an offer so remote description is set
    await act(async () => {
      es.emit('signal', {
        type: 'offer',
        sdp: 'mock-sdp-offer',
        senderId: 'host-1',
        timestamp: Date.now(),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    pc.addIceCandidate.mockClear();

    // Now send ICE candidate — should be added directly
    await act(async () => {
      es.emit('signal', {
        type: 'ice-candidate',
        candidate: { candidate: 'mock-candidate' },
        senderId: 'host-1',
        timestamp: Date.now(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pc.addIceCandidate).toHaveBeenCalled();
  });

  it('should handle kick message from data channel', async () => {
    const onKicked = vi.fn();
    const { hookResult, pc } = await initWithConnected({ ...defaultOptions, onKicked });

    // Simulate incoming data channel from host
    const mockChannel = {
      readyState: 'open',
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as ((err: unknown) => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
      close: vi.fn(),
      send: vi.fn(),
    };

    act(() => {
      pc.ondatachannel?.({ channel: mockChannel });
    });

    // Trigger onopen
    act(() => {
      mockChannel.onopen?.();
    });

    expect(hookResult.current.dataChannelReady).toBe(true);

    // Simulate kick message
    act(() => {
      mockChannel.onmessage?.({
        data: JSON.stringify({ type: 'kick', timestamp: Date.now() }),
      } as MessageEvent);
    });

    expect(hookResult.current.error).toBe('You were removed from the session');
    expect(onKicked).toHaveBeenCalled();
  });

  it('should handle mute message from data channel', async () => {
    const { hookResult, pc } = await initWithConnected();

    expect(hookResult.current.micEnabled).toBe(true);

    const mockChannel = {
      readyState: 'open',
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as ((err: unknown) => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
      close: vi.fn(),
      send: vi.fn(),
    };

    act(() => {
      pc.ondatachannel?.({ channel: mockChannel });
      mockChannel.onopen?.();
    });

    // Simulate mute message
    act(() => {
      mockChannel.onmessage?.({
        data: JSON.stringify({
          type: 'mute',
          muted: true,
          participantId: 'viewer-1',
          timestamp: Date.now(),
        }),
      } as MessageEvent);
    });

    expect(hookResult.current.micEnabled).toBe(false);
  });

  it('should send control request via data channel', async () => {
    const { hookResult, pc } = await initWithConnected();

    const mockChannel = {
      readyState: 'open',
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onerror: null as ((err: unknown) => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null,
      close: vi.fn(),
      send: vi.fn(),
    };

    act(() => {
      pc.ondatachannel?.({ channel: mockChannel });
      mockChannel.onopen?.();
    });

    act(() => {
      hookResult.current.requestControl();
    });

    expect(hookResult.current.controlState).toBe('requested');
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"control-request"')
    );
  });

  it('should toggle mic on/off', async () => {
    const { hookResult } = await initWithConnected();

    expect(hookResult.current.micEnabled).toBe(true);

    act(() => {
      hookResult.current.toggleMic();
    });

    expect(hookResult.current.micEnabled).toBe(false);
    expect(mockAudioTrack.enabled).toBe(false);

    act(() => {
      hookResult.current.toggleMic();
    });

    expect(hookResult.current.micEnabled).toBe(true);
    expect(mockAudioTrack.enabled).toBe(true);
  });

  it('should clean up on disconnect', async () => {
    const { hookResult, es, pc } = await initWithConnected();

    act(() => {
      hookResult.current.disconnect();
    });

    expect(pc.close).toHaveBeenCalled();
    expect(es.close).toHaveBeenCalled();
    expect(hookResult.current.connectionState).toBe('disconnected');
    expect(hookResult.current.remoteStream).toBeNull();
  });

  it('should set connectionState on SSE connected event', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.emit('connected', connectedEventData);
    });

    expect(hookResult!.current.connectionState).toBe('connecting');
    expect(hookResult!.current.error).toBeNull();
  });

  it('should handle SSE error', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es.emit('error', '');
    });

    expect(hookResult!.current.error).toBe('Connection to server lost. Reconnecting...');
  });

  describe('ICE candidate buffering', () => {
    it('should buffer ICE candidates received before remote description is set', async () => {
      const { es, pc } = await initWithConnected();

      // PC has no remoteDescription yet — ICE candidate should be buffered
      expect(pc.remoteDescription).toBeNull();

      await act(async () => {
        es.emit('signal', {
          type: 'ice-candidate',
          candidate: { candidate: 'buffered-candidate-1' },
          senderId: 'host-1',
          timestamp: Date.now(),
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      // Now send an offer to set remote description and drain candidates
      await act(async () => {
        es.emit('signal', {
          type: 'offer',
          sdp: 'mock-sdp-offer',
          senderId: 'host-1',
          timestamp: Date.now(),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // After the offer is processed, the buffered candidate should have been drained
      expect(pc.setRemoteDescription).toHaveBeenCalledWith({
        type: 'offer',
        sdp: 'mock-sdp-offer',
      });
      expect(pc.addIceCandidate).toHaveBeenCalled();
    });

    it('should directly add ICE candidate when remote description exists', async () => {
      const { es, pc } = await initWithConnected();

      // First, set remote description via offer
      await act(async () => {
        es.emit('signal', {
          type: 'offer',
          sdp: 'mock-sdp-offer',
          senderId: 'host-1',
          timestamp: Date.now(),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      pc.addIceCandidate.mockClear();

      // Now send an ICE candidate — should be added directly
      await act(async () => {
        es.emit('signal', {
          type: 'ice-candidate',
          candidate: { candidate: 'direct-candidate' },
          senderId: 'host-1',
          timestamp: Date.now(),
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(pc.addIceCandidate).toHaveBeenCalled();
    });
  });

  describe('ICE servers from SSE connected event', () => {
    it('should parse iceServers from connected event data', async () => {
      let hookResult: { current: ReturnType<typeof useWebRTCViewerAPI> };

      await act(async () => {
        const { result } = renderHook(() => useWebRTCViewerAPI(defaultOptions));
        hookResult = result;
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const es = MockEventSource.instances[0];

      // Emit connected event with ICE servers including TURN
      act(() => {
        es.emit(
          'connected',
          JSON.stringify({
            sessionId: 'session-1',
            subscriberId: 'viewer-1',
            isHost: false,
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
            ],
          })
        );
      });

      // Verify the hook transitioned to connecting state and PC was created
      expect(hookResult!.current.connectionState).toBe('connecting');
      expect(hookResult!.current.error).toBeNull();
      expect(MockRTCPeerConnection.instances).toHaveLength(1);
    });
  });
});
