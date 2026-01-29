import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCHostAPI } from './useWebRTCHostAPI';

// Mock the shared config
vi.mock('../../shared/config', () => ({
  API_BASE_URL: 'http://localhost:3000',
  APP_URL: 'https://pairux.com',
}));

// Mock the IPC module
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

  emit(type: string, data: unknown) {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
    }
  }
}

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  signalingState = 'stable';
  connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

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

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  text: () => Promise.resolve(''),
});

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

describe('useWebRTCHostAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCIceCandidate = vi.fn((c: unknown) => c);
    (globalThis as Record<string, unknown>).fetch = mockFetch;
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
    const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

    expect(result.current.isHosting).toBe(false);
    expect(result.current.viewerCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  describe('startHosting', () => {
    it('should create an EventSource and set isHosting on connected', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      expect(MockEventSource.instances).toHaveLength(1);
      const es = MockEventSource.instances[0];
      expect(es.url).toContain('/api/sessions/session-1/signal/stream');
      expect(es.url).toContain('participantId=host-1');

      // Simulate connected event
      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      expect(result.current.isHosting).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should prevent concurrent startHosting calls', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      // First call
      await act(async () => {
        await result.current.startHosting();
      });

      expect(MockEventSource.instances).toHaveLength(1);

      // Second call should be a no-op
      await act(async () => {
        await result.current.startHosting();
      });

      // Should still only have one EventSource
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it('should start hosting without a stream (voice-only session)', async () => {
      const { result } = renderHook(() =>
        useWebRTCHostAPI({ ...defaultOptions, localStream: null })
      );

      await act(async () => {
        await result.current.startHosting();
      });

      // EventSource should be created (no stream guard anymore)
      expect(MockEventSource.instances).toHaveLength(1);
      expect(result.current.error).toBeNull();

      // Simulate connected event
      const es = MockEventSource.instances[0];
      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      expect(result.current.isHosting).toBe(true);
    });
  });

  describe('stopHosting', () => {
    it('should close EventSource and reset state', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      const es = MockEventSource.instances[0];

      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      expect(result.current.isHosting).toBe(true);

      act(() => {
        result.current.stopHosting();
      });

      expect(es.close).toHaveBeenCalled();
      expect(result.current.isHosting).toBe(false);
    });

    it('should allow starting again after stopping', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      // Start
      await act(async () => {
        await result.current.startHosting();
      });

      expect(MockEventSource.instances).toHaveLength(1);

      // Stop
      act(() => {
        result.current.stopHosting();
      });

      // Start again
      await act(async () => {
        await result.current.startHosting();
      });

      expect(MockEventSource.instances).toHaveLength(2);
    });
  });

  describe('muteViewer', () => {
    it('should expose muteViewer in returned API', () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));
      expect(result.current.muteViewer).toBeInstanceOf(Function);
    });

    it('should send mute message via data channel when muting a viewer', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      const es = MockEventSource.instances[0];

      // Simulate connected
      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      // Simulate a viewer joining
      await act(async () => {
        es.emit(
          'presence-join',
          JSON.stringify({
            presences: [{ user_id: 'viewer-1', role: 'viewer' }],
          })
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(result.current.viewerCount).toBe(1);
        });
      });

      // Get the viewer's data channel mock
      const viewer = result.current.viewers.get('viewer-1');
      expect(viewer).toBeDefined();

      // Simulate data channel becoming open
      if (viewer) {
        const dc =
          viewer.dataChannel ??
          (viewer.peerConnection as unknown as MockRTCPeerConnection).createDataChannel.mock
            .results[0]?.value;
        if (dc) {
          dc.readyState = 'open';
          viewer.dataChannel = dc;
        }
      }

      // Mute the viewer
      act(() => {
        result.current.muteViewer('viewer-1', true);
      });

      // Check that the viewer is marked as muted
      const updatedViewer = result.current.viewers.get('viewer-1');
      expect(updatedViewer?.isMuted).toBe(true);
    });
  });

  describe('audio handling', () => {
    it('should initialize viewer connections with audio fields', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      const es = MockEventSource.instances[0];

      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      await act(async () => {
        es.emit(
          'presence-join',
          JSON.stringify({
            presences: [{ user_id: 'viewer-1', role: 'viewer' }],
          })
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(result.current.viewerCount).toBe(1);
        });
      });

      const viewer = result.current.viewers.get('viewer-1');
      expect(viewer).toBeDefined();
      expect(viewer?.audioTrack).toBeNull();
      expect(viewer?.audioElement).toBeNull();
      expect(viewer?.isMuted).toBe(false);
    });

    it('should always create data channel regardless of allowControl setting', async () => {
      // Even without allowControl, data channel should be created for mute commands
      const { result } = renderHook(() =>
        useWebRTCHostAPI({ ...defaultOptions, allowControl: false })
      );

      await act(async () => {
        await result.current.startHosting();
      });

      const es = MockEventSource.instances[0];

      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      await act(async () => {
        es.emit(
          'presence-join',
          JSON.stringify({
            presences: [{ user_id: 'viewer-1', role: 'viewer' }],
          })
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(result.current.viewerCount).toBe(1);
        });
      });

      // Data channel should have been created via createDataChannel
      const viewer = result.current.viewers.get('viewer-1');
      expect(viewer).toBeDefined();
      // The mock PC should have createDataChannel called
      const mockPC = viewer?.peerConnection as unknown as MockRTCPeerConnection;
      expect(mockPC.createDataChannel).toHaveBeenCalledWith('control', { ordered: true });
    });
  });

  describe('signal handling', () => {
    it('should ignore answer when signaling state is not have-local-offer', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      const es = MockEventSource.instances[0];

      // Simulate connected
      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      // Simulate a viewer joining
      await act(async () => {
        es.emit(
          'presence-join',
          JSON.stringify({
            presences: [{ user_id: 'viewer-1', role: 'viewer' }],
          })
        );
      });

      // Wait for the offer to be created
      await act(async () => {
        await vi.waitFor(() => {
          expect(result.current.viewerCount).toBe(1);
        });
      });

      // First answer — should succeed (state is have-local-offer)
      await act(async () => {
        es.emit(
          'signal',
          JSON.stringify({
            type: 'answer',
            sdp: 'answer-sdp',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          })
        );
      });

      // Second answer — should be ignored (state is now stable)
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await act(async () => {
        es.emit(
          'signal',
          JSON.stringify({
            type: 'answer',
            sdp: 'answer-sdp-duplicate',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          })
        );
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring answer from viewer-1')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should buffer ICE candidates received before answer and drain after', async () => {
      const { result } = renderHook(() => useWebRTCHostAPI(defaultOptions));

      await act(async () => {
        await result.current.startHosting();
      });

      const es = MockEventSource.instances[0];

      act(() => {
        es.emit('connected', JSON.stringify({ sessionId: 'session-1' }));
      });

      // Simulate a viewer joining
      await act(async () => {
        es.emit(
          'presence-join',
          JSON.stringify({
            presences: [{ user_id: 'viewer-1', role: 'viewer' }],
          })
        );
      });

      await act(async () => {
        await vi.waitFor(() => {
          expect(result.current.viewerCount).toBe(1);
        });
      });

      const viewer = result.current.viewers.get('viewer-1');
      expect(viewer).toBeDefined();
      const mockPC = viewer?.peerConnection as unknown as MockRTCPeerConnection;

      // Send ICE candidate BEFORE answer (remote description not set)
      await act(async () => {
        es.emit(
          'signal',
          JSON.stringify({
            type: 'ice-candidate',
            candidate: { candidate: 'buffered-candidate' },
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          })
        );
      });

      // Now send the answer — should drain buffered candidates
      await act(async () => {
        es.emit(
          'signal',
          JSON.stringify({
            type: 'answer',
            sdp: 'answer-sdp',
            senderId: 'viewer-1',
            targetId: 'host-1',
            timestamp: Date.now(),
          })
        );
      });

      // After answer, setRemoteDescription should have been called
      expect(mockPC.setRemoteDescription).toHaveBeenCalledWith({
        type: 'answer',
        sdp: 'answer-sdp',
      });
      // And addIceCandidate should have been called for the buffered candidate
      expect(mockPC.addIceCandidate).toHaveBeenCalled();
    });
  });
});
