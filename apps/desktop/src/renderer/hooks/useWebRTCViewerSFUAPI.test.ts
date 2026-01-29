import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCViewerSFUAPI } from './useWebRTCViewerSFUAPI';

// Polyfill MediaStream for jsdom
class MockMediaStream {
  tracks: unknown[];
  constructor(tracks: unknown[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => (t as { kind?: string }).kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => (t as { kind?: string }).kind === 'video');
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
}
(globalThis as Record<string, unknown>).MediaStream = MockMediaStream;

// Mock modules
vi.mock('../../shared/config', () => ({
  API_BASE_URL: 'http://localhost:3000',
  APP_URL: 'https://pairux.com',
}));

vi.mock('@/lib/ipc', () => ({
  getElectronAPI: () => ({
    invoke: vi.fn().mockResolvedValue({ token: 'test-auth-token' }),
  }),
}));

// Mock LiveKit Room
const mockPublishData = vi.fn();
const mockSetMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
const mockGetTrackPublication = vi.fn().mockReturnValue(null);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockRemoteParticipants = new Map();

const mockLocalParticipant = {
  publishData: mockPublishData,
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
  getTrackPublication: mockGetTrackPublication,
};

class MockRoom {
  state = 'connected';
  localParticipant = mockLocalParticipant;
  remoteParticipants = mockRemoteParticipants;
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, handler: (...args: unknown[]) => void) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(handler);
    this.listeners.set(event, existing);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  connect = mockConnect;
  disconnect = mockDisconnect;
}

let mockRoomInstance: MockRoom;

vi.mock('livekit-client', () => {
  return {
    Room: vi.fn().mockImplementation(() => {
      mockRoomInstance = new MockRoom();
      return mockRoomInstance;
    }),
    RoomEvent: {
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      ConnectionStateChanged: 'connectionStateChanged',
      DataReceived: 'dataReceived',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      Disconnected: 'disconnected',
    },
    Track: {
      Kind: { Video: 'video', Audio: 'audio' },
      Source: {
        ScreenShare: 'screen_share',
        ScreenShareAudio: 'screen_share_audio',
        Microphone: 'microphone',
      },
    },
    ConnectionState: {
      Disconnected: 'disconnected',
      Connecting: 'connecting',
      Connected: 'connected',
      Reconnecting: 'reconnecting',
    },
  };
});

// Mock fetch for token endpoint
const mockFetch = vi.fn();

describe('useWebRTCViewerSFUAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteParticipants.clear();

    // Re-set mock implementations (vi.restoreAllMocks clears them)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            token: 'lk-test-token',
            url: 'wss://livekit.example.com',
            roomName: 'session-session-1',
          },
        }),
    });
    mockPublishData.mockResolvedValue(undefined);
    mockSetMicrophoneEnabled.mockResolvedValue(undefined);
    mockGetTrackPublication.mockReturnValue(null);
    mockDisconnect.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(undefined);

    (globalThis as Record<string, unknown>).fetch = mockFetch;
  });

  afterEach(() => {
    // Don't use vi.restoreAllMocks() - it resets vi.mock() implementations
    // and breaks cleanup code that runs after afterEach
  });

  const defaultOptions = {
    sessionId: 'session-1',
    participantId: 'viewer-1',
  };

  it('should initialize with default state', () => {
    // Block the fetch to prevent initialization from completing
    (globalThis as Record<string, unknown>).fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));

    expect(result.current.connectionState).toBe('connecting');
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.controlState).toBe('view-only');
    expect(result.current.dataChannelReady).toBe(false);
  });

  it('should fetch LiveKit token with Bearer auth', async () => {
    await act(async () => {
      renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/livekit/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-auth-token',
        }),
        body: expect.stringContaining('"isHost":false'),
      })
    );
  });

  it('should connect to LiveKit room with token', async () => {
    await act(async () => {
      renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockConnect).toHaveBeenCalledWith('wss://livekit.example.com', 'lk-test-token');
  });

  it('should enable microphone after connecting', async () => {
    await act(async () => {
      renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it('should set micEnabled=true on successful mic capture', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hookResult!.current.hasMic).toBe(true);
    expect(hookResult!.current.micEnabled).toBe(true);
  });

  it('should handle mic failure gracefully', async () => {
    mockSetMicrophoneEnabled.mockRejectedValueOnce(new Error('No mic'));

    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hookResult!.current.hasMic).toBe(false);
    expect(hookResult!.current.micEnabled).toBe(false);
  });

  it('should set remoteStream on TrackSubscribed for video', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const mockVideoTrack = {
      kind: 'video',
      mediaStreamTrack: { id: 'video-1', kind: 'video' },
    };

    act(() => {
      mockRoomInstance.emit('trackSubscribed', mockVideoTrack, {}, { identity: 'host-1' });
    });

    expect(hookResult!.current.remoteStream).not.toBeNull();
  });

  it('should clear remoteStream on TrackUnsubscribed for video', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // First subscribe
    const mockVideoTrack = {
      kind: 'video',
      mediaStreamTrack: { id: 'video-1', kind: 'video' },
    };

    act(() => {
      mockRoomInstance.emit('trackSubscribed', mockVideoTrack, {}, { identity: 'host-1' });
    });

    expect(hookResult!.current.remoteStream).not.toBeNull();

    // Then unsubscribe
    act(() => {
      mockRoomInstance.emit('trackUnsubscribed', mockVideoTrack);
    });

    expect(hookResult!.current.remoteStream).toBeNull();
  });

  it('should handle kick message from data channel', async () => {
    const onKicked = vi.fn();
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI({ ...defaultOptions, onKicked }));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const kickMessage = new TextEncoder().encode(
      JSON.stringify({ type: 'kick', timestamp: Date.now() })
    );

    act(() => {
      mockRoomInstance.emit('dataReceived', kickMessage, { identity: 'host-1' });
    });

    expect(hookResult!.current.error).toBe('You were removed from the session');
    expect(onKicked).toHaveBeenCalled();
  });

  it('should handle control-grant message', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const grantMessage = new TextEncoder().encode(
      JSON.stringify({
        type: 'control-grant',
        participantId: 'viewer-1',
        timestamp: Date.now(),
      })
    );

    act(() => {
      mockRoomInstance.emit('dataReceived', grantMessage, { identity: 'host-1' });
    });

    expect(hookResult!.current.controlState).toBe('granted');
  });

  it('should send control request via publishData', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate connected state setting dataChannelReady
    act(() => {
      mockRoomInstance.emit('connectionStateChanged', 'connected');
    });

    act(() => {
      hookResult!.current.requestControl();
    });

    expect(hookResult!.current.controlState).toBe('requested');
    expect(mockPublishData).toHaveBeenCalled();
  });

  it('should toggle mic via LiveKit', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hookResult!.current.micEnabled).toBe(true);

    act(() => {
      hookResult!.current.toggleMic();
    });

    expect(hookResult!.current.micEnabled).toBe(false);
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it('should handle token fetch failure', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });

    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hookResult!.current.connectionState).toBe('failed');
    expect(hookResult!.current.error).toBe('Unauthorized');
  });

  it('should disconnect and clean up', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      hookResult!.current.disconnect();
    });

    expect(mockDisconnect).toHaveBeenCalled();
    expect(hookResult!.current.connectionState).toBe('disconnected');
    expect(hookResult!.current.remoteStream).toBeNull();
    expect(hookResult!.current.dataChannelReady).toBe(false);
  });

  it('should detect host disconnect via metadata', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mockRoomInstance.emit('participantDisconnected', {
        identity: 'host-1',
        metadata: JSON.stringify({ role: 'host' }),
      });
    });

    expect(hookResult!.current.error).toBe('Host disconnected. Waiting for reconnection...');
  });

  it('should clear error when host reconnects', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Host disconnects
    act(() => {
      mockRoomInstance.emit('participantDisconnected', {
        identity: 'host-1',
        metadata: JSON.stringify({ role: 'host' }),
      });
    });

    expect(hookResult!.current.error).toBe('Host disconnected. Waiting for reconnection...');

    // Host reconnects
    act(() => {
      mockRoomInstance.emit('participantConnected', {
        identity: 'host-1',
        metadata: JSON.stringify({ role: 'host' }),
      });
    });

    expect(hookResult!.current.error).toBeNull();
  });
});
