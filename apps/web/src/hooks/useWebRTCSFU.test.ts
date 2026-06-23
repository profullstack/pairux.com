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

vi.mock('livekit-client', () => ({
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
});
