import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCHostSFUAPI } from './useWebRTCHostSFUAPI';

class MockMediaStream {
  private tracks: { kind: string; id?: string; stop?: () => void }[];
  constructor(tracks: { kind: string; id?: string; stop?: () => void }[] = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}
(globalThis as Record<string, unknown>).MediaStream = MockMediaStream;

const mockAudioPlay = vi.fn().mockResolvedValue(undefined);
const mockAudioPause = vi.fn();

class MockAudioElement {
  srcObject: MediaStream | null = null;
  autoplay = false;
  volume = 1;
  muted = false;
  play = mockAudioPlay;
  pause = mockAudioPause;
}
(globalThis as Record<string, unknown>).Audio = MockAudioElement;

vi.mock('../../shared/config', () => ({
  API_BASE_URL: 'http://localhost:3000',
  APP_URL: 'https://pairux.com',
}));

vi.mock('@/lib/ipc', () => ({
  getElectronAPI: () => ({
    invoke: vi.fn().mockResolvedValue({ token: 'desktop-auth-token' }),
  }),
}));

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockPublishTrack = vi.fn().mockResolvedValue(undefined);
const mockPublishData = vi.fn().mockResolvedValue(undefined);
const mockUnpublishTrack = vi.fn().mockResolvedValue(undefined);
const mockTrackPublications = new Map();
const mockRemoteParticipants = new Map();

const mockLocalParticipant = {
  publishTrack: mockPublishTrack,
  publishData: mockPublishData,
  unpublishTrack: mockUnpublishTrack,
  trackPublications: mockTrackPublications,
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
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    DataReceived: 'dataReceived',
    ConnectionStateChanged: 'connectionStateChanged',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
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
const mockGetUserMedia = vi.fn();

describe('useWebRTCHostSFUAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but not implementations; a prior test's
    // mockRejectedValue would otherwise leak into the next. Reset connect/disconnect.
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockDisconnect.mockReset().mockResolvedValue(undefined);
    mockRemoteParticipants.clear();
    mockTrackPublications.clear();

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

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      },
      configurable: true,
      writable: true,
    });

    mockGetUserMedia.mockResolvedValue(
      new MockMediaStream([
        { kind: 'audio', id: 'host-mic-1', stop: vi.fn() },
      ]) as unknown as MediaStream
    );
  });

  it('plays participant audio when an SFU audio track is subscribed', async () => {
    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({
        sessionId: 'session-1',
        hostId: 'host-1',
        localStream: null,
      })
    );

    await act(async () => {
      await result.current.startHosting();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mockRoomInstance.emit('participantConnected', { identity: 'viewer-1' });
    });

    const remoteAudioTrack = {
      kind: 'audio',
      mediaStreamTrack: { kind: 'audio', id: 'viewer-audio-1' },
    };

    act(() => {
      mockRoomInstance.emit('trackSubscribed', remoteAudioTrack, {}, { identity: 'viewer-1' });
    });

    const viewer = result.current.viewers.get('viewer-1');
    expect(viewer).toBeDefined();
    expect(viewer?.audioElement).toBeInstanceOf(MockAudioElement);
    expect(mockAudioPlay).toHaveBeenCalled();
  });

  it('cleans up participant audio element when the audio track is unsubscribed', async () => {
    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({
        sessionId: 'session-1',
        hostId: 'host-1',
        localStream: null,
      })
    );

    await act(async () => {
      await result.current.startHosting();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mockRoomInstance.emit('participantConnected', { identity: 'viewer-1' });
    });

    const remoteAudioTrack = {
      kind: 'audio',
      mediaStreamTrack: { kind: 'audio', id: 'viewer-audio-1' },
    };

    act(() => {
      mockRoomInstance.emit('trackSubscribed', remoteAudioTrack, {}, { identity: 'viewer-1' });
    });

    act(() => {
      mockRoomInstance.emit('trackUnsubscribed', remoteAudioTrack, {}, { identity: 'viewer-1' });
    });

    const viewer = result.current.viewers.get('viewer-1');
    expect(viewer?.audioTrack).toBeNull();
    expect(viewer?.audioElement).toBeNull();
    expect(mockAudioPause).toHaveBeenCalled();
  });

  it('clears the error and stays hosting after livekit reconnects from a transient blip', async () => {
    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({
        sessionId: 'session-1',
        hostId: 'host-1',
        localStream: null,
      })
    );

    await act(async () => {
      await result.current.startHosting();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A terminal-looking disconnect surfaces the error toast...
    act(() => {
      mockRoomInstance.emit('connectionStateChanged', 'disconnected');
    });
    expect(result.current.error).toBe('Disconnected from server');
    expect(result.current.isHosting).toBe(false);

    // ...but when livekit recovers on its own, the toast clears and hosting resumes.
    act(() => {
      mockRoomInstance.emit('reconnected');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isHosting).toBe(true);
  });

  it('retries the host connection and succeeds on a later attempt (no error toast)', async () => {
    vi.useFakeTimers();
    mockConnect
      .mockRejectedValueOnce(new Error('could not establish pc connection'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({ sessionId: 'session-1', hostId: 'host-1', localStream: null })
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.startHosting();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.isHosting).toBe(true);
    expect(result.current.error).toBeNull();
    vi.useRealTimers();
  });

  it('surfaces an error only after exhausting connect retries', async () => {
    vi.useFakeTimers();
    mockConnect.mockRejectedValue(new Error('could not establish pc connection'));

    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({ sessionId: 'session-1', hostId: 'host-1', localStream: null })
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.startHosting();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(result.current.isHosting).toBe(false);
    expect(result.current.error).toBe('could not establish pc connection');
    vi.useRealTimers();
  });

  it('ignores a concurrent startHosting call (no duplicate connection storm)', async () => {
    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({ sessionId: 'session-1', hostId: 'host-1', localStream: null })
    );

    // Two overlapping starts (as the auto-start effect can do) — the second
    // must bail on the re-entrancy guard rather than build a second Room.
    await act(async () => {
      await Promise.all([result.current.startHosting(), result.current.startHosting()]);
      await Promise.resolve();
    });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(result.current.isHosting).toBe(true);
  });

  it('can re-host after a terminal disconnect (guard released)', async () => {
    const { result } = renderHook(() =>
      useWebRTCHostSFUAPI({ sessionId: 'session-1', hostId: 'host-1', localStream: null })
    );

    await act(async () => {
      await result.current.startHosting();
      await Promise.resolve();
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Terminal disconnect — must release the room ref.
    act(() => {
      mockRoomInstance.emit('connectionStateChanged', 'disconnected');
    });
    expect(result.current.isHosting).toBe(false);

    // A fresh start now proceeds instead of bailing on the (stale) guard.
    await act(async () => {
      await result.current.startHosting();
      await Promise.resolve();
    });
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(result.current.isHosting).toBe(true);
  });
});
