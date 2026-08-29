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

  // Remote control is gated twice: the session must allow control at all, and
  // the host must approve the specific participant. These cover the first gate,
  // which was previously accepted as an option and then ignored entirely.
  describe('allowControl enforcement', () => {
    const encode = (message: unknown) => new TextEncoder().encode(JSON.stringify(message));

    async function startHost(allowControl: boolean) {
      const onControlRequest = vi.fn();
      const onInputReceived = vi.fn();

      const { result } = renderHook(() =>
        useWebRTCHostSFUAPI({
          sessionId: 'session-1',
          hostId: 'host-1',
          localStream: null,
          allowControl,
          onControlRequest,
          onInputReceived,
        })
      );

      await act(async () => {
        await result.current.startHosting();
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        mockRoomInstance.emit('participantConnected', {
          identity: 'viewer-1',
          audioTrackPublications: new Map(),
        });
      });

      return { result, onControlRequest, onInputReceived };
    }

    it('only forwards ordered input from the host-granted viewer', async () => {
      const { result, onControlRequest, onInputReceived } = await startHost(true);

      act(() => {
        mockRoomInstance.emit(
          'dataReceived',
          encode({ type: 'control-request', participantId: 'viewer-1', timestamp: 1 }),
          { identity: 'viewer-1', audioTrackPublications: new Map() }
        );
      });
      expect(onControlRequest).toHaveBeenCalledWith('viewer-1');

      // Allowing control for a session is not a grant to every participant.
      // Input before explicit host approval is discarded.
      act(() => {
        mockRoomInstance.emit(
          'dataReceived',
          encode({
            type: 'input',
            timestamp: 1,
            sequence: 1,
            event: { type: 'mouse', action: 'move', x: 0.5, y: 0.5 },
          }),
          { identity: 'viewer-1', audioTrackPublications: new Map() }
        );
      });
      expect(onInputReceived).not.toHaveBeenCalled();

      act(() => {
        result.current.grantControl('viewer-1');
      });

      act(() => {
        mockRoomInstance.emit(
          'dataReceived',
          encode({
            type: 'input',
            timestamp: 1,
            sequence: 1,
            event: { type: 'mouse', action: 'move', x: 0.5, y: 0.5 },
          }),
          { identity: 'viewer-1', audioTrackPublications: new Map() }
        );
      });
      expect(onInputReceived).toHaveBeenCalledTimes(1);

      // A delayed/replayed packet must never move the shared host pointer.
      act(() => {
        mockRoomInstance.emit(
          'dataReceived',
          encode({
            type: 'input',
            timestamp: 2,
            sequence: 1,
            event: { type: 'mouse', action: 'move', x: 0.75, y: 0.75 },
          }),
          { identity: 'viewer-1', audioTrackPublications: new Map() }
        );
      });
      expect(onInputReceived).toHaveBeenCalledTimes(1);
    });

    it('drops control requests and input when the session disallows control', async () => {
      const { onControlRequest, onInputReceived } = await startHost(false);

      act(() => {
        mockRoomInstance.emit(
          'dataReceived',
          encode({ type: 'control-request', participantId: 'viewer-1', timestamp: 1 }),
          { identity: 'viewer-1', audioTrackPublications: new Map() }
        );
        mockRoomInstance.emit(
          'dataReceived',
          encode({
            type: 'input',
            timestamp: 1,
            sequence: 1,
            event: { type: 'mouse', action: 'move', x: 0.5, y: 0.5 },
          }),
          { identity: 'viewer-1', audioTrackPublications: new Map() }
        );
      });

      expect(onControlRequest).not.toHaveBeenCalled();
      expect(onInputReceived).not.toHaveBeenCalled();
    });

    it('refuses to grant control when the session disallows control', async () => {
      const { result } = await startHost(false);

      act(() => {
        result.current.grantControl('viewer-1');
      });

      expect(result.current.controllingViewer).toBeNull();
    });

    it('grants control when the session allows control', async () => {
      const { result } = await startHost(true);

      act(() => {
        result.current.grantControl('viewer-1');
      });

      expect(result.current.controllingViewer).toBe('viewer-1');
    });
  });

  // Regression: a viewer already in the room has their tracks subscribed
  // during connect(), before the "track existing participants" pass runs. The
  // handler used to require an existing viewer entry and silently dropped the
  // track, leaving that participant inaudible for the whole session.
  it('plays audio that is subscribed before the viewer has been registered', async () => {
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

    const remoteAudioTrack = {
      kind: 'audio',
      mediaStreamTrack: { kind: 'audio', id: 'early-audio' },
    };

    // No participantConnected first, and not in remoteParticipants: audio
    // arrives for a viewer the hook has never seen.
    act(() => {
      mockRoomInstance.emit(
        'trackSubscribed',
        remoteAudioTrack,
        {},
        {
          identity: 'viewer-early',
          audioTrackPublications: new Map(),
        }
      );
    });

    const viewer = result.current.viewers.get('viewer-early');
    expect(viewer).toBeDefined();
    expect(viewer?.audioElement).toBeInstanceOf(MockAudioElement);
    expect(mockAudioPlay).toHaveBeenCalled();
  });

  it('picks up audio already subscribed when a participant is registered', async () => {
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

    // Participant shows up already carrying a subscribed audio publication.
    act(() => {
      mockRoomInstance.emit('participantConnected', {
        identity: 'viewer-existing',
        audioTrackPublications: new Map([
          ['pub-1', { track: { mediaStreamTrack: { kind: 'audio', id: 'existing-audio' } } }],
        ]),
      });
    });

    const viewer = result.current.viewers.get('viewer-existing');
    expect(viewer?.audioElement).toBeInstanceOf(MockAudioElement);
    expect(mockAudioPlay).toHaveBeenCalled();
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
      mockRoomInstance.emit('participantConnected', {
        identity: 'viewer-1',
        audioTrackPublications: new Map(),
      });
    });

    const remoteAudioTrack = {
      kind: 'audio',
      mediaStreamTrack: { kind: 'audio', id: 'viewer-audio-1' },
    };

    act(() => {
      mockRoomInstance.emit(
        'trackSubscribed',
        remoteAudioTrack,
        {},
        { identity: 'viewer-1', audioTrackPublications: new Map() }
      );
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
      mockRoomInstance.emit('participantConnected', {
        identity: 'viewer-1',
        audioTrackPublications: new Map(),
      });
    });

    const remoteAudioTrack = {
      kind: 'audio',
      mediaStreamTrack: { kind: 'audio', id: 'viewer-audio-1' },
    };

    act(() => {
      mockRoomInstance.emit(
        'trackSubscribed',
        remoteAudioTrack,
        {},
        { identity: 'viewer-1', audioTrackPublications: new Map() }
      );
    });

    act(() => {
      mockRoomInstance.emit(
        'trackUnsubscribed',
        remoteAudioTrack,
        {},
        { identity: 'viewer-1', audioTrackPublications: new Map() }
      );
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

  /**
   * Regression: turning the camera bubble on swaps the raw screen track for a
   * composited one and republishes. Publishing again left *both* tracks up, and
   * the viewer — which folds every subscribed video track into one MediaStream
   * and renders only the first — kept showing the pre-camera screen. The camera
   * never reached anyone. Reported from a real session as "I was able to see
   * myself in the preview window, but my pair was unable to see me".
   */
  describe('republishing the presentation track', () => {
    const mockReplaceTrack = vi.fn().mockResolvedValue(undefined);

    /** Mirror LiveKit: a successful publish shows up in trackPublications. */
    function trackPublishingRoom() {
      mockReplaceTrack.mockClear();
      mockPublishTrack.mockImplementation((track: { id: string }, options: { source: string }) => {
        const publication = {
          source: options.source,
          track: { mediaStreamTrack: track, replaceTrack: mockReplaceTrack },
        };
        mockTrackPublications.set(options.source, publication);
        return Promise.resolve(publication);
      });
    }

    async function hostWithScreenTrack() {
      trackPublishingRoom();
      const { result } = renderHook(() =>
        useWebRTCHostSFUAPI({ sessionId: 'session-1', hostId: 'host-1', localStream: null })
      );

      await act(async () => {
        await result.current.startHosting();
        await Promise.resolve();
      });

      const screenTrack = { kind: 'video', id: 'screen-track' };
      await act(async () => {
        await result.current.publishStream(
          new MockMediaStream([screenTrack]) as unknown as MediaStream
        );
      });

      return { result, screenTrack };
    }

    it('replaces the published video instead of publishing a second track', async () => {
      const { result } = await hostWithScreenTrack();

      const videoPublishes = () =>
        mockPublishTrack.mock.calls.filter(
          (call) => (call[1] as { source: string }).source === 'screen_share'
        );

      expect(videoPublishes()).toHaveLength(1);

      // Camera on: the composited canvas track replaces the screen track.
      const compositeTrack = { kind: 'video', id: 'composite-track' };
      await act(async () => {
        await result.current.publishStream(
          new MockMediaStream([compositeTrack]) as unknown as MediaStream
        );
      });

      expect(videoPublishes()).toHaveLength(1);
      expect(mockReplaceTrack).toHaveBeenCalledTimes(1);
      expect(mockReplaceTrack).toHaveBeenCalledWith(compositeTrack);
    });

    it('does not replace when handed the track it is already publishing', async () => {
      const { result, screenTrack } = await hostWithScreenTrack();

      // A re-render republishing the identical track must be a no-op, not a
      // needless renegotiation on every state change in the capture view.
      await act(async () => {
        await result.current.publishStream(
          new MockMediaStream([screenTrack]) as unknown as MediaStream
        );
      });

      expect(mockReplaceTrack).not.toHaveBeenCalled();
      expect(
        mockPublishTrack.mock.calls.filter(
          (call) => (call[1] as { source: string }).source === 'screen_share'
        )
      ).toHaveLength(1);
    });

    it('marks the replacement track as detail content for the encoder', async () => {
      const { result } = await hostWithScreenTrack();

      const compositeTrack: { kind: string; id: string; contentHint?: string } = {
        kind: 'video',
        id: 'composite-track',
      };
      await act(async () => {
        await result.current.publishStream(
          new MockMediaStream([compositeTrack]) as unknown as MediaStream
        );
      });

      expect(compositeTrack.contentHint).toBe('detail');
    });
  });

  // Issue #70: on macOS the app terminated in ScreenCaptureKit/ReplayKit after
  // repeatedly publishing the same screen_share track while the room recovered.
  // The publish path decides replace-vs-publish *before* it awaits, so two
  // overlapping callers both decided "publish".
  describe('concurrent publication of the screen share', () => {
    const mockReplaceTrack = vi.fn().mockResolvedValue(undefined);

    /**
     * Mirror livekit with a publish that stays in flight: the publication only
     * appears in `trackPublications` once the returned promise resolves. That
     * window is the entire bug, and the existing helper above cannot express it
     * because it resolves synchronously.
     */
    function slowPublishingRoom() {
      mockReplaceTrack.mockClear();
      const pending: (() => void)[] = [];

      const publicationFor = (track: { id: string }, options: { source: string }) => {
        const publication = {
          source: options.source,
          track: { mediaStreamTrack: track, replaceTrack: mockReplaceTrack },
        };
        mockTrackPublications.set(options.source, publication);
        return publication;
      };

      mockPublishTrack.mockImplementation((track: { id: string }, options: { source: string }) => {
        // Only the screen share is held open. startHosting awaits the host mic
        // publish inline, so deferring that one would hang the test before it
        // ever reaches the code under test.
        if (options.source !== 'screen_share') {
          return Promise.resolve(publicationFor(track, options));
        }
        return new Promise((resolve) => {
          pending.push(() => {
            resolve(publicationFor(track, options));
          });
        });
      });

      return {
        inFlight: () => pending.length,
        settleAll: () => {
          while (pending.length > 0) pending.shift()?.();
        },
      };
    }

    /** Let queued microtasks run without letting a hung promise stall the test. */
    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };

    async function hostingRoom() {
      const { result } = renderHook(() =>
        useWebRTCHostSFUAPI({ sessionId: 'session-1', hostId: 'host-1', localStream: null })
      );
      await act(async () => {
        await result.current.startHosting();
        await Promise.resolve();
      });
      return result;
    }

    const videoPublishes = () =>
      mockPublishTrack.mock.calls.filter(
        (call) => (call[1] as { source: string }).source === 'screen_share'
      );

    it('publishes the screen track once when two publishes overlap', async () => {
      const room = slowPublishingRoom();
      const result = await hostingRoom();

      const screenTrack = { kind: 'video', id: 'screen-track' };

      await act(async () => {
        // Both calls are made before either can finish — the shape produced by
        // the publish effect re-running while a publish is still awaiting.
        const first = result.current.publishStream(
          new MockMediaStream([screenTrack]) as unknown as MediaStream
        );
        const second = result.current.publishStream(
          new MockMediaStream([screenTrack]) as unknown as MediaStream
        );

        await flush();
        room.settleAll();
        await flush();
        // Settle again so an unserialised second publish resolves too, and this
        // test fails on the assertion rather than timing out.
        room.settleAll();
        await Promise.all([first, second]);
      });

      expect(videoPublishes()).toHaveLength(1);
    });

    it('does not let an unpublish interleave with an in-flight publish', async () => {
      const room = slowPublishingRoom();
      const result = await hostingRoom();

      const screenTrack = { kind: 'video', id: 'screen-track' };

      await act(async () => {
        const publishing = result.current.publishStream(
          new MockMediaStream([screenTrack]) as unknown as MediaStream
        );
        await flush();

        // The unpublish must wait its turn: running it now would tear down the
        // publication the in-flight publish is still creating, leaving viewers
        // on a black frame with the host still marked live.
        const unpublishing = result.current.unpublishStream();
        await flush();
        expect(mockUnpublishTrack).not.toHaveBeenCalled();

        room.settleAll();
        await Promise.all([publishing, unpublishing]);
      });

      expect(mockUnpublishTrack).toHaveBeenCalledTimes(1);
    });

    it('treats an already-published track as success, not an error', async () => {
      const result = await hostingRoom();

      // livekit's rejection when a duplicate slips through anyway. Surfacing it
      // is what drove the caller into another retry, and the retries are what
      // restarted capture underneath the running ScreenCaptureKit stream.
      mockPublishTrack.mockRejectedValue(
        new Error('a track with the same ID has already been published')
      );

      await act(async () => {
        await expect(
          result.current.publishStream(
            new MockMediaStream([{ kind: 'video', id: 'screen-track' }]) as unknown as MediaStream
          )
        ).resolves.toBeUndefined();
      });
    });

    it('skips a publish whose capture session has already been superseded', async () => {
      slowPublishingRoom();
      const result = await hostingRoom();

      await act(async () => {
        await result.current.publishStream(
          new MockMediaStream([{ kind: 'video', id: 'stale-track' }]) as unknown as MediaStream,
          () => true
        );
      });

      expect(videoPublishes()).toHaveLength(0);
    });
  });
});
