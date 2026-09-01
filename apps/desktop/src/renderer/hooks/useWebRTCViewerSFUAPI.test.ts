import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Room } from 'livekit-client';
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
  removeTrack(track: unknown) {
    this.tracks = this.tracks.filter((t) => t !== track);
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

// Remote audio now plays through one element per participant, each fronted by a
// Web Audio gain stage. jsdom has no AudioContext, so stand in for the graph and
// record which tracks were wired up.
interface AmplifiedStub {
  track: { id?: string };
  disposed: boolean;
  setGain: ReturnType<typeof vi.fn>;
  dispose: () => void;
}
const amplified: AmplifiedStub[] = [];
vi.mock('@/lib/remoteAudioGain', () => ({
  amplifyRemoteAudio: (track: { id?: string }) => {
    const entry: AmplifiedStub = {
      track,
      disposed: false,
      setGain: vi.fn(),
      dispose: () => {
        entry.disposed = true;
      },
    };
    (entry as unknown as { stream: unknown }).stream = new MockMediaStream([track]);
    amplified.push(entry);
    return entry;
  },
}));

/** The audio elements the hook created, in creation order. */
const audioElements: { muted: boolean; paused: boolean; srcObject: unknown }[] = [];
class MockAudio {
  muted = false;
  paused = false;
  autoplay = false;
  volume = 1;
  srcObject: unknown = null;
  constructor() {
    audioElements.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
(globalThis as Record<string, unknown>).Audio = MockAudio;

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
    amplified.length = 0;
    audioElements.length = 0;

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

    expect(mockConnect).toHaveBeenCalledWith(
      'wss://livekit.example.com',
      'lk-test-token',
      expect.objectContaining({ rtcConfig: expect.any(Object) })
    );
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

  it('should keep remote audio out of the remote stream and play it per participant', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const hostAudio = { kind: 'audio', mediaStreamTrack: { id: 'audio-host', kind: 'audio' } };
    const peerAudio = { kind: 'audio', mediaStreamTrack: { id: 'audio-peer', kind: 'audio' } };
    const mockVideoTrack = { kind: 'video', mediaStreamTrack: { id: 'video-1', kind: 'video' } };

    // A media element plays only the FIRST audio track of the stream it is
    // given, so folding both of these into remoteStream made whichever arrived
    // second inaudible for the whole session. Each one gets its own element.
    act(() => {
      mockRoomInstance.emit('trackSubscribed', hostAudio, {}, { identity: 'host-1' });
      mockRoomInstance.emit('trackSubscribed', peerAudio, {}, { identity: 'viewer-2' });
    });

    expect(hookResult!.current.remoteStream).toBeNull();
    expect(audioElements).toHaveLength(2);
    expect(amplified.map((a) => a.track.id)).toEqual(['audio-host', 'audio-peer']);

    act(() => {
      mockRoomInstance.emit('trackSubscribed', mockVideoTrack, {}, { identity: 'host-1' });
    });

    // The stream carries video and nothing else.
    const videoStream = hookResult!.current.remoteStream;
    expect(videoStream?.getVideoTracks()).toHaveLength(1);
    expect(videoStream?.getAudioTracks()).toHaveLength(0);

    // One participant leaving tears down only their own playback.
    act(() => {
      mockRoomInstance.emit('trackUnsubscribed', peerAudio);
    });

    expect(amplified.find((a) => a.track.id === 'audio-peer')?.disposed).toBe(true);
    expect(amplified.find((a) => a.track.id === 'audio-host')?.disposed).toBe(false);
    expect(hookResult!.current.remoteStream?.getVideoTracks()).toHaveLength(1);
  });

  it('should mute every remote participant through setSpeakerMuted', async () => {
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
      mockRoomInstance.emit(
        'trackSubscribed',
        { kind: 'audio', mediaStreamTrack: { id: 'audio-host', kind: 'audio' } },
        {},
        { identity: 'host-1' }
      );
    });

    // Remote audio no longer lives in the <video>, so muting that element is not
    // enough — the speaker button has to reach these.
    act(() => {
      hookResult!.current.setSpeakerMuted(true);
    });
    expect(audioElements.every((el) => el.muted)).toBe(true);

    // Somebody joining while muted stays muted.
    act(() => {
      mockRoomInstance.emit(
        'trackSubscribed',
        { kind: 'audio', mediaStreamTrack: { id: 'audio-late', kind: 'audio' } },
        {},
        { identity: 'viewer-3' }
      );
    });
    expect(audioElements).toHaveLength(2);
    expect(audioElements.every((el) => el.muted)).toBe(true);

    act(() => {
      hookResult!.current.setSpeakerMuted(false);
    });
    expect(audioElements.every((el) => el.muted)).toBe(false);
  });

  it('should disable adaptiveStream so the screen share is never auto-paused', async () => {
    await act(async () => {
      renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // livekit only counts a track as "visible" when it was handed to
    // track.attach(). We build the MediaStream by hand and set it as a
    // <video> srcObject, so livekit sees zero attached elements and would
    // disable the subscription part-way through a session.
    expect(Room).toHaveBeenCalledWith(expect.objectContaining({ adaptiveStream: false }));
  });

  it('should emit a fresh stream when the host restarts sharing with mic still subscribed', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const mockAudioTrack = { kind: 'audio', mediaStreamTrack: { id: 'audio-1', kind: 'audio' } };
    const firstVideo = { kind: 'video', mediaStreamTrack: { id: 'video-1', kind: 'video' } };
    const secondVideo = { kind: 'video', mediaStreamTrack: { id: 'video-2', kind: 'video' } };

    act(() => {
      mockRoomInstance.emit('trackSubscribed', mockAudioTrack, {}, { identity: 'host-1' });
      mockRoomInstance.emit('trackSubscribed', firstVideo, {}, { identity: 'host-1' });
    });

    const sharing = hookResult!.current.remoteStream;
    expect(sharing?.getVideoTracks()).toHaveLength(1);

    // Host stops sharing. Their mic stays subscribed but is played elsewhere,
    // so the video stream empties out rather than surviving as a stale
    // reference that a replacement track gets added to in place.
    act(() => {
      mockRoomInstance.emit('trackUnsubscribed', firstVideo);
    });

    expect(hookResult!.current.remoteStream).toBeNull();
    expect(amplified.find((a) => a.track.id === 'audio-1')?.disposed).toBe(false);

    // Host starts a new share.
    act(() => {
      mockRoomInstance.emit('trackSubscribed', secondVideo, {}, { identity: 'host-1' });
    });

    const restarted = hookResult!.current.remoteStream;
    expect(restarted).not.toBe(sharing);
    expect(restarted?.getVideoTracks()).toHaveLength(1);
    expect((restarted?.getVideoTracks()[0] as { id?: string } | undefined)?.id).toBe('video-2');
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

  it('should ignore control messages addressed to another participant', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    await act(async () => {
      const { result } = renderHook(() => useWebRTCViewerSFUAPI(defaultOptions));
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const encode = (message: unknown) => new TextEncoder().encode(JSON.stringify(message));

    act(() => {
      mockRoomInstance.emit(
        'dataReceived',
        encode({ type: 'control-grant', participantId: 'viewer-1', timestamp: Date.now() }),
        { identity: 'host-1' }
      );
    });
    expect(hookResult!.current.controlState).toBe('granted');

    // Another guest releasing control used to be broadcast untargeted, and
    // every other guest applied it to themselves — so the person actually
    // driving was silently dropped back to view-only.
    act(() => {
      mockRoomInstance.emit(
        'dataReceived',
        encode({ type: 'control-revoke', participantId: 'viewer-2', timestamp: Date.now() }),
        { identity: 'viewer-2' }
      );
    });
    expect(hookResult!.current.controlState).toBe('granted');

    // A revoke that really is ours still lands.
    act(() => {
      mockRoomInstance.emit(
        'dataReceived',
        encode({ type: 'control-revoke', participantId: 'viewer-1', timestamp: Date.now() }),
        { identity: 'host-1' }
      );
    });
    expect(hookResult!.current.controlState).toBe('view-only');
  });

  it('should address control requests to the participant sharing their screen', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCViewerSFUAPI> };

    mockRemoteParticipants.set('host-1', {
      identity: 'host-1',
      metadata: JSON.stringify({ role: 'host' }),
      videoTrackPublications: new Map([['screen', { source: 'screen_share' }]]),
    });
    mockRemoteParticipants.set('viewer-2', {
      identity: 'viewer-2',
      metadata: JSON.stringify({ role: 'viewer' }),
      videoTrackPublications: new Map(),
    });

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

    mockPublishData.mockClear();
    act(() => {
      hookResult!.current.requestControl();
    });

    // Only the presenter can act on it, and only the presenter should see it.
    expect(mockPublishData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ destinationIdentities: ['host-1'] })
    );
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
