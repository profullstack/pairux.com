import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCSFU } from './useWebRTCSFU';

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

const mockPublishData = vi.fn().mockResolvedValue(undefined);
const mockSetMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
const mockGetTrackPublication = vi.fn().mockReturnValue(null);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
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

// Capture the Room constructor options so we can assert adaptiveStream is off.
const { roomCtorSpy } = vi.hoisted(() => ({ roomCtorSpy: vi.fn() }));

vi.mock('livekit-client', () => ({
  Room: vi.fn().mockImplementation((opts: unknown) => {
    roomCtorSpy(opts);
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
      Microphone: 'microphone',
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio',
    },
  },
  ConnectionState: {
    Disconnected: 'disconnected',
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
  },
}));

const mockFetch = vi.fn();

describe('useWebRTCSFU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteParticipants.clear();
    (globalThis as Record<string, unknown>).fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            token: 'lk-token',
            url: 'wss://livekit.example.com',
            roomName: 'session-1',
          },
        }),
    });
  });

  async function micViewer() {
    mockRemoteParticipants.set('presenter', {
      identity: 'presenter',
      videoTrackPublications: new Map([['screen', { source: 'screen_share' }]]),
    });
    const view = renderHook(() =>
      useWebRTCSFU({ sessionId: 'session-1', participantId: 'viewer-1' })
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    return view;
  }
  function muteMessage(muted: unknown, target = 'viewer-1', room = mockRoomInstance) {
    room.emit(
      'dataReceived',
      new TextEncoder().encode(JSON.stringify({ type: 'mute', muted, participantId: target })),
      { identity: 'presenter' }
    );
  }

  it('requires local consent, ignores invalid/foreign mute, and keeps mute on reconnect', async () => {
    const { result } = await micViewer();
    expect(result.current.micEnabled).toBe(true);
    await act(async () => {
      muteMessage(true, 'someone-else');
      muteMessage(undefined);
      muteMessage('false');
    });
    expect(result.current.micEnabled).toBe(true);
    await act(async () => {
      muteMessage(true);
    });
    expect(result.current.micEnabled).toBe(false);
    mockSetMicrophoneEnabled.mockClear();
    await act(async () => {
      muteMessage(false);
      muteMessage(false);
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(result.current.unmuteRequested).toBe(true);
    const oldRoom = mockRoomInstance;
    await act(async () => {
      result.current.reconnect();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    expect(result.current.micEnabled).toBe(false);
    act(() => muteMessage(false, 'viewer-1', oldRoom));
    expect(result.current.unmuteRequested).toBe(false);
    await act(async () => {
      result.current.toggleMic();
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(result.current.micEnabled).toBe(true);
  });

  it('does not override a mute received while connecting', async () => {
    let resolve!: () => void;
    mockConnect.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const { result } = await micViewer();
    act(() => muteMessage(true));
    await act(async () => {
      resolve();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    expect(result.current.micEnabled).toBe(false);
  });

  it('does not acquire a microphone after unmount during connect', async () => {
    let resolve!: () => void;
    mockConnect.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const { unmount } = await micViewer();
    unmount();
    await act(async () => {
      resolve();
    });
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('contains failed local enable without reporting the microphone as active', async () => {
    const { result } = await micViewer();
    await act(async () => {
      result.current.toggleMic();
    });
    mockSetMicrophoneEnabled.mockRejectedValueOnce(new Error('permission denied'));
    await act(async () => {
      result.current.toggleMic();
    });
    expect(result.current.micEnabled).toBe(false);
    expect(result.current.hasMic).toBe(false);
    await act(async () => {
      muteMessage(true);
    });
    expect(result.current.hasMic).toBe(false);
  });

  it('only shows unmute requests from a current screen publisher', async () => {
    const { result } = await micViewer();
    await act(async () => {
      muteMessage(true);
    });
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'mute', muted: false, participantId: 'viewer-1' })
    );
    mockRemoteParticipants.set('guest', {
      identity: 'guest',
      metadata: '{"role":"host"}',
      videoTrackPublications: new Map(),
    });
    act(() => {
      mockRoomInstance.emit('dataReceived', payload);
      mockRoomInstance.emit('dataReceived', payload, { identity: 'guest' });
    });
    expect(result.current.unmuteRequested).toBe(false);
    act(() => {
      muteMessage(false);
    });
    expect(result.current.unmuteRequested).toBe(true);
    expect(result.current.micEnabled).toBe(false);
  });

  it('does not report active audio when host mute races local permission', async () => {
    const { result } = await micViewer();
    await act(async () => {
      result.current.toggleMic();
    });
    let resolve!: () => void;
    mockSetMicrophoneEnabled.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    await act(async () => {
      result.current.toggleMic();
    });
    await act(async () => {
      muteMessage(true);
    });
    await act(async () => {
      resolve();
    });
    expect(result.current.micEnabled).toBe(false);
    expect(mockSetMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it('reasserts mute on SDK reconnect and ignores old-room state events', async () => {
    const { result } = await micViewer();
    await act(async () => {
      result.current.toggleMic();
    });
    mockSetMicrophoneEnabled.mockClear();
    await act(async () => {
      mockRoomInstance.emit('connectionStateChanged', 'reconnecting');
      mockRoomInstance.emit('connectionStateChanged', 'connected');
    });
    expect(mockSetMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(result.current.micEnabled).toBe(false);
    const oldRoom = mockRoomInstance;
    await act(async () => {
      result.current.reconnect();
    });
    act(() => {
      mockRoomInstance.emit('connectionStateChanged', 'connected');
    });
    await act(async () => {
      oldRoom.emit('connectionStateChanged', 'disconnected');
      oldRoom.emit('disconnected');
    });
    expect(result.current.connectionState).toBe('connected');
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalledWith(true);
  });

  it('merges subscribed audio and video tracks into one remote stream and preserves video on audio unsubscribe', async () => {
    let hookResult: { current: ReturnType<typeof useWebRTCSFU> };

    await act(async () => {
      const { result } = renderHook(() =>
        useWebRTCSFU({ sessionId: 'session-1', participantId: 'viewer-1' })
      );
      hookResult = result;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const audioTrack = {
      kind: 'audio',
      mediaStreamTrack: { id: 'audio-1', kind: 'audio' },
    };
    const videoTrack = {
      kind: 'video',
      mediaStreamTrack: { id: 'video-1', kind: 'video' },
    };

    act(() => {
      mockRoomInstance.emit('trackSubscribed', audioTrack, {}, { identity: 'host-1' });
    });

    const firstStream = hookResult!.current.remoteStream;
    expect(firstStream).not.toBeNull();
    expect(firstStream?.getAudioTracks()).toHaveLength(1);

    act(() => {
      mockRoomInstance.emit('trackSubscribed', videoTrack, {}, { identity: 'host-1' });
    });

    // A NEW MediaStream reference each time a track changes, so the <video>'s
    // srcObject effect re-runs. Firefox won't render a track added to a stream
    // that is already attached to the element, which left the screen black when
    // the video arrived after the audio.
    const secondStream = hookResult!.current.remoteStream;
    expect(secondStream).not.toBe(firstStream);
    expect(secondStream?.getAudioTracks()).toHaveLength(1);
    expect(secondStream?.getVideoTracks()).toHaveLength(1);

    act(() => {
      mockRoomInstance.emit('trackUnsubscribed', audioTrack);
    });

    const thirdStream = hookResult!.current.remoteStream;
    expect(thirdStream).not.toBe(secondStream);
    expect(thirdStream?.getAudioTracks()).toHaveLength(0);
    expect(thirdStream?.getVideoTracks()).toHaveLength(1);
  });

  it('creates the room with adaptiveStream disabled so screen-share video is not paused', async () => {
    await act(async () => {
      renderHook(() => useWebRTCSFU({ sessionId: 'session-1', participantId: 'viewer-1' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(roomCtorSpy).toHaveBeenCalledWith(expect.objectContaining({ adaptiveStream: false }));
  });
});
