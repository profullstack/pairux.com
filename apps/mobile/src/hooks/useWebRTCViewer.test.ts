import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebRTCViewer } from './useWebRTCViewer';
import { createEventSource } from '../lib/event-source';
import { getValidAccessToken } from '../lib/auth-session';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { emitAppStateChange, mockPeerConnections } from '../test/setup';
import {
  viewerConnectedEventData,
  AUTH_USER_ID,
  PARTICIPANT_ROW_ID,
  HOST_USER_ID,
  OTHER_VIEWER_ID,
} from '../test/fixtures/server-contracts';

vi.mock('../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

vi.mock('../lib/auth-session', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue('test-token'),
}));

const { mockClose, mockAddEventListener, mockEventSources } = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockAddEventListener: vi.fn(),
  mockEventSources: [] as {
    listeners: Map<string, (event: { data: string }) => void>;
    close: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('../lib/event-source', () => ({
  createEventSource: vi.fn((_url: string, _options?: { headers?: Record<string, string> }) => {
    const listeners = new Map<string, (event: { data: string }) => void>();
    const source = {
      listeners,
      addEventListener: vi.fn((event: string, listener: (payload: { data: string }) => void) => {
        mockAddEventListener(event, listener);
        listeners.set(event, listener);
      }),
      close: vi.fn(() => {
        mockClose();
      }),
    };
    mockEventSources.push(source);
    return source;
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useWebRTCViewer', () => {
  async function connectChannel() {
    const track = { kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() };
    vi.mocked(mediaDevices.getUserMedia).mockResolvedValueOnce({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream);
    const hook = renderHook(() =>
      useWebRTCViewer({ sessionId: 'session-1', participantId: 'viewer-1' })
    );
    await waitFor(() => expect(mockEventSources).toHaveLength(1));
    await act(async () => {
      mockEventSources[0].listeners.get('connected')?.({ data: '{}' });
      mockEventSources[0].listeners.get('signal')?.({
        data: JSON.stringify({
          type: 'offer',
          sdp: 'offer',
          senderId: 'host-1',
          targetId: 'viewer-1',
          timestamp: Date.now(),
        }),
      });
    });
    await waitFor(() => expect(mockPeerConnections.length).toBeGreaterThan(0));
    const listeners = new Map<string, (event: { data: string }) => void>();
    const channel = {
      readyState: 'open',
      addEventListener: (name: string, callback: (event: { data: string }) => void) =>
        listeners.set(name, callback),
      close: vi.fn(),
    };
    const receive = mockPeerConnections[0].addEventListener.mock.calls.find(
      ([name]) => name === 'datachannel'
    )?.[1] as (event: unknown) => void;
    act(() => receive({ channel }));
    const send = (value: unknown) =>
      act(() => listeners.get('message')?.({ data: JSON.stringify(value) }));
    return { ...hook, track, send, listeners };
  }

  it('clears an old unmute request when the same SSE connection replaces its peer', async () => {
    const f = await connectChannel();
    f.send({ type: 'mute', muted: true });
    f.send({ type: 'mute', muted: false });
    expect(f.result.current.unmuteRequested).toBe(true);
    act(() => {
      mockEventSources[0].listeners.get('connected')?.({ data: '{}' });
    });
    expect(f.result.current.unmuteRequested).toBe(false);
    f.send({ type: 'mute', muted: false });
    expect(f.result.current.unmuteRequested).toBe(false);
    expect(f.track.enabled).toBe(false);
  });

  it('recognizes native denial and preserves the initial-on policy on Settings-style resume', async () => {
    vi.mocked(mediaDevices.getUserMedia).mockRejectedValueOnce({
      name: 'SecurityError',
      message: 'Permission denied.',
    });
    const f = renderHook(() =>
      useWebRTCViewer({ sessionId: 'session-1', participantId: 'viewer-1' })
    );
    await waitFor(() => expect(f.result.current.micFailure).toBe('permission'));
    act(() => {
      emitAppStateChange('background');
    });
    act(() => {
      emitAppStateChange('active');
    });
    await waitFor(() => expect(f.result.current.hasMic).toBe(true));
    expect(f.result.current.micFailure).toBeNull();
    // Existing initial-on policy is preserved; Settings does not add a new opt-in gate.
    expect(f.result.current.micEnabled).toBe(true);
  });

  it('turns host unmute into a request, with local action required to enable tracks', async () => {
    const f = await connectChannel();
    f.send({ type: 'mute', muted: true });
    expect(f.track.enabled).toBe(false);
    f.send({ type: 'mute', muted: false });
    f.send({ type: 'mute', muted: false });
    expect(f.track.enabled).toBe(false);
    expect(f.result.current.unmuteRequested).toBe(true);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    act(() => f.result.current.toggleMic());
    expect(f.track.enabled).toBe(true);
    expect(f.result.current.unmuteRequested).toBe(false);
    f.send({ type: 'mute', muted: false });
    expect(f.result.current.unmuteRequested).toBe(false);
  });
  it.each([undefined, 'false', 0, null])('ignores malformed mute value %s', async (muted) => {
    const f = await connectChannel();
    f.send({ type: 'mute', muted: true });
    f.send({ type: 'mute', muted });
    expect(f.track.enabled).toBe(false);
    expect(f.result.current.unmuteRequested).toBe(false);
  });
  it('drops stale channel requests after reconnect and persists host mute into a late stream', async () => {
    const f = await connectChannel();
    f.send({ type: 'mute', muted: true });
    f.send({ type: 'mute', muted: false });
    const mic = deferred<MediaStream>();
    vi.mocked(mediaDevices.getUserMedia).mockReturnValueOnce(mic.promise);
    act(() => emitAppStateChange('background'));
    expect(f.result.current.unmuteRequested).toBe(false);
    await act(async () => emitAppStateChange('active'));
    f.send({ type: 'mute', muted: false });
    expect(f.result.current.unmuteRequested).toBe(false);
    const track = { kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() };
    await act(async () =>
      mic.resolve({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      } as unknown as MediaStream)
    );
    expect(track.enabled).toBe(false);
    expect(f.result.current.micEnabled).toBe(false);
  });
  it('does not pretend an ended track can unmute', async () => {
    const f = await connectChannel();
    f.send({ type: 'mute', muted: true });
    f.track.readyState = 'ended';
    act(() => f.result.current.toggleMic());
    expect(f.result.current.micEnabled).toBe(false);
    expect(f.result.current.hasMic).toBe(false);
    expect(f.result.current.micFailure).toBe('unavailable');
  });
  it.each(['NotAllowedError', 'DeviceError', 'Error'])(
    'exposes a conservative mic failure for %s',
    async (name) => {
      vi.mocked(mediaDevices.getUserMedia).mockRejectedValueOnce(
        Object.assign(new Error('PRIVATE'), { name })
      );
      const { result } = renderHook(() =>
        useWebRTCViewer({ sessionId: 'session-1', participantId: 'viewer-1' })
      );
      await waitFor(() =>
        expect(result.current.micFailure).toBe(
          name === 'NotAllowedError' ? 'permission' : 'unavailable'
        )
      );
      expect(result.current.hasMic).toBe(false);
      expect(createEventSource).toHaveBeenCalled();
    }
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSources.length = 0;
    vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    } as Response);
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    expect(result.current.connectionState).toBe('idle');
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.qualityMetrics).toBeNull();
    expect(result.current.networkQuality).toBe('good');
    expect(result.current.error).toBeNull();
    expect(result.current.controlState).toBe('view-only');
    expect(result.current.dataChannelReady).toBe(false);
    expect(result.current.micEnabled).toBe(false);
    expect(result.current.hasMic).toBe(false);
  });

  it('should expose all required API methods', () => {
    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    expect(typeof result.current.reconnect).toBe('function');
    expect(typeof result.current.disconnect).toBe('function');
    expect(typeof result.current.requestControl).toBe('function');
    expect(typeof result.current.releaseControl).toBe('function');
    expect(typeof result.current.sendInput).toBe('function');
    expect(typeof result.current.toggleMic).toBe('function');
  });

  it('should auto-initialize SSE connection on mount', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(createEventSource).toHaveBeenCalledWith(
      expect.stringContaining('/api/sessions/session-1/signal/stream'),
      expect.anything()
    );
  });

  it('should include participantId in SSE URL params', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-42',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(createEventSource).toHaveBeenCalledWith(
      expect.stringContaining('participantId=viewer-42'),
      expect.anything()
    );
  });

  it('sends the SSE bearer token in the Authorization header, not the URL', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const [url, options] = vi.mocked(createEventSource).mock.calls[0] as [
      string,
      { headers?: Record<string, string> } | undefined,
    ];
    expect(url).not.toContain('token=');
    expect(options).toEqual({ headers: { Authorization: 'Bearer test-token' } });
  });

  it('echoes the host negotiation ID in its answer', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const connectedListener = mockAddEventListener.mock.calls.find(
      ([eventName]) => eventName === 'connected'
    )?.[1] as ((event: { data: string }) => void) | undefined;
    const signalListener = mockAddEventListener.mock.calls.find(
      ([eventName]) => eventName === 'signal'
    )?.[1] as ((event: { data: string }) => void) | undefined;
    expect(connectedListener).toBeDefined();
    expect(signalListener).toBeDefined();

    await act(async () => {
      connectedListener?.({ data: '{}' });
      signalListener?.({
        data: JSON.stringify({
          type: 'offer',
          sdp: 'mobile-host-offer',
          senderId: 'host-1',
          targetId: 'viewer-1',
          negotiationId: 'mobile-offer-1',
          timestamp: Date.now(),
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://pairux.com/api/sessions/session-1/signal',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"negotiationId":"mobile-offer-1"'),
      })
    );
  });

  it('should set error when not authenticated', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.error).toBe('Not authenticated. Please log in again.');
  });

  it('should disconnect and clean up resources', async () => {
    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      result.current.disconnect();
    });

    expect(mockClose).toHaveBeenCalled();
    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.remoteStream).toBeNull();
    expect(result.current.dataChannelReady).toBe(false);
  });

  it('should reset state on reconnect', async () => {
    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      result.current.reconnect();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should have created a new EventSource (2 total: initial + reconnect)
    expect(createEventSource).toHaveBeenCalledTimes(2);
  });

  it('should clean up on unmount', async () => {
    const { unmount } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();
    expect(mockClose).toHaveBeenCalled();
  });

  it('does not reconnect when callback identities change', async () => {
    const { rerender } = renderHook(
      ({ onReady }: { onReady: (stream: MediaStream) => void }) =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: 'viewer-1',
          onStreamReady: onReady,
        }),
      { initialProps: { onReady: vi.fn() } }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender({ onReady: vi.fn() });
    await act(async () => {
      await Promise.resolve();
    });

    expect(createEventSource).toHaveBeenCalledTimes(1);
  });

  it('tears down once in the background and resumes exactly once when active', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createEventSource).toHaveBeenCalledTimes(1);

    act(() => {
      emitAppStateChange('inactive');
    });
    expect(mockClose).not.toHaveBeenCalled();

    act(() => {
      emitAppStateChange('background');
    });
    expect(mockClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAppStateChange('active');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createEventSource).toHaveBeenCalledTimes(2);
  });

  it('handles an offer during a transient inactive window', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const source = mockEventSources[0];
    expect(source).toBeDefined();

    act(() => {
      source.listeners.get('connected')?.({ data: '{}' });
      emitAppStateChange('inactive');
    });
    const peer = mockPeerConnections[0];
    expect(peer).toBeDefined();

    await act(async () => {
      source.listeners.get('signal')?.({
        data: JSON.stringify({
          type: 'offer',
          sdp: 'mobile-host-offer',
          senderId: 'host-1',
          targetId: 'viewer-1',
          negotiationId: 'inactive-offer-1',
          timestamp: Date.now(),
        }),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/session-1/signal',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"negotiationId":"inactive-offer-1"'),
        })
      )
    );
    expect(source.close).not.toHaveBeenCalled();
  });

  it('keeps heartbeats current throughout a long inactive window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));

    try {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: 'viewer-1',
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];
      expect(source).toBeDefined();

      act(() => {
        source.listeners.get('connected')?.({ data: '{}' });
        emitAppStateChange('inactive');
      });

      for (let elapsed = 10_000; elapsed <= 80_000; elapsed += 10_000) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
          source.listeners.get('heartbeat')?.({ data: '{}' });
        });
      }

      await act(async () => {
        emitAppStateChange('active');
        await vi.advanceTimersByTimeAsync(16_000);
      });

      expect(source.close).not.toHaveBeenCalled();
      expect(createEventSource).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects on foreground after the watchdog expires while inactive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));

    try {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: 'viewer-1',
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];
      expect(source).toBeDefined();

      act(() => {
        source.listeners.get('connected')?.({ data: '{}' });
        emitAppStateChange('inactive');
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });

      expect(source.close).toHaveBeenCalledTimes(1);
      expect(createEventSource).toHaveBeenCalledTimes(1);

      await act(async () => {
        emitAppStateChange('active');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(createEventSource).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores connected callbacks from a retired background generation', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const staleConnectedListener = mockEventSources[0]?.listeners.get('connected');

    act(() => {
      emitAppStateChange('background');
    });
    await act(async () => {
      emitAppStateChange('active');
      await Promise.resolve();
      await Promise.resolve();
    });
    const currentConnectedListener = mockEventSources[1]?.listeners.get('connected');

    act(() => {
      staleConnectedListener?.({ data: '{}' });
    });
    expect(mockPeerConnections).toHaveLength(0);

    act(() => {
      currentConnectedListener?.({ data: '{}' });
    });
    expect(mockPeerConnections).toHaveLength(1);
  });

  it('replaces the remote stream when the same SSE connection reconnects', async () => {
    const onStreamReady = vi.fn();
    const onStreamEnded = vi.fn();
    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
        onStreamReady,
        onStreamEnded,
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const connectedListener = mockEventSources[0]?.listeners.get('connected');
    const makeRemoteStream = (id: string): MediaStream =>
      ({
        id,
        getTracks: () => [{ kind: 'video' }],
        getAudioTracks: () => [],
        getVideoTracks: () => [{ kind: 'video' }],
      }) as unknown as MediaStream;
    const firstStream = makeRemoteStream('first');
    const secondStream = makeRemoteStream('second');

    act(() => {
      connectedListener?.({ data: '{}' });
    });
    const firstPeer = mockPeerConnections[0];
    const firstTrackListener = firstPeer.addEventListener.mock.calls.find(
      ([eventName]) => eventName === 'track'
    )?.[1] as ((event: { streams: MediaStream[] }) => void) | undefined;
    act(() => {
      firstTrackListener?.({ streams: [firstStream] });
    });
    expect(result.current.remoteStream).toBe(firstStream);

    act(() => {
      connectedListener?.({ data: '{}' });
    });
    expect(firstPeer.close).toHaveBeenCalledTimes(1);
    expect(result.current.remoteStream).toBeNull();
    expect(onStreamEnded).toHaveBeenCalledTimes(1);

    const secondPeer = mockPeerConnections[1];
    const secondTrackListener = secondPeer.addEventListener.mock.calls.find(
      ([eventName]) => eventName === 'track'
    )?.[1] as ((event: { streams: MediaStream[] }) => void) | undefined;
    act(() => {
      secondTrackListener?.({ streams: [secondStream] });
    });

    expect(result.current.remoteStream).toBe(secondStream);
    expect(onStreamReady).toHaveBeenNthCalledWith(1, firstStream);
    expect(onStreamReady).toHaveBeenNthCalledWith(2, secondStream);
  });

  it('preserves the viewer microphone mute intent across a foreground reconnect', async () => {
    const tracks: (MediaStreamTrack & {
      enabled: boolean;
      stop: ReturnType<typeof vi.fn>;
    })[] = [];
    const makeMicStream = (): MediaStream => {
      const track = {
        kind: 'audio',
        enabled: true,
        stop: vi.fn(),
      } as unknown as MediaStreamTrack & {
        enabled: boolean;
        stop: ReturnType<typeof vi.fn>;
      };
      tracks.push(track);
      return {
        getTracks: () => [track],
        getAudioTracks: () => [track],
      } as unknown as MediaStream;
    };
    vi.mocked(mediaDevices.getUserMedia)
      .mockResolvedValueOnce(makeMicStream())
      .mockResolvedValueOnce(makeMicStream());

    const { result } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.toggleMic();
    });
    expect(tracks[0]?.enabled).toBe(false);

    act(() => {
      emitAppStateChange('background');
    });
    await act(async () => {
      emitAppStateChange('active');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tracks[1]?.enabled).toBe(false);
    expect(result.current.micEnabled).toBe(false);
  });

  it('stops a late microphone stream when unmounted during initialization', async () => {
    let resolveMic!: (stream: MediaStream) => void;
    const lateTrack = {
      kind: 'audio',
      enabled: true,
      stop: vi.fn(),
    } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
    const lateStream = {
      getTracks: () => [lateTrack],
      getAudioTracks: () => [lateTrack],
    } as unknown as MediaStream;
    vi.mocked(mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMic = resolve;
      })
    );

    const { unmount } = renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    unmount();

    await act(async () => {
      resolveMic(lateStream);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(lateTrack.stop).toHaveBeenCalledTimes(1);
    expect(createEventSource).not.toHaveBeenCalled();
  });

  it('restarts once after the SSE heartbeat expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));

    try {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: 'viewer-1',
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_001);
        await Promise.resolve();
      });

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(createEventSource).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('signaling identity and cross-viewer guards', () => {
    const requestBody = (init?: RequestInit): string =>
      typeof init?.body === 'string' ? init.body : '';

    /** Connects the SSE stream and delivers one targeted host offer. */
    async function connectAndReceiveHostOffer() {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: PARTICIPANT_ROW_ID,
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];
      expect(source).toBeDefined();

      act(() => {
        source.listeners.get('connected')?.({ data: viewerConnectedEventData() });
      });
      const peer = mockPeerConnections[0];
      expect(peer).toBeDefined();

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'host-offer-sdp',
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      return { source, peer };
    }

    it('adopts the server-assigned subscriberId for outgoing answers', async () => {
      const { peer } = await connectAndReceiveHostOffer();

      expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          'https://pairux.com/api/sessions/session-1/signal',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining(`"senderId":"${AUTH_USER_ID}"`),
          })
        )
      );
      // The answer goes back to the host, not broadcast
      const answerCall = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => requestBody(init).includes('"type":"answer"'));
      expect(answerCall).toBeDefined();
      expect(requestBody(answerCall?.[1])).toContain(`"targetId":"${HOST_USER_ID}"`);
      // The participant row id must not leak into signaling identities
      expect(requestBody(answerCall?.[1])).not.toContain(PARTICIPANT_ROW_ID);
    });

    it("ignores another viewer's broadcast ICE-restart offer", async () => {
      const { source, peer } = await connectAndReceiveHostOffer();
      expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'other-viewer-restart-offer',
            senderId: OTHER_VIEWER_ID,
            // no targetId: exactly how a viewer ICE restart is broadcast
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
    });

    it("drops another viewer's broadcast ICE candidates but accepts the host's targeted ones", async () => {
      const { source, peer } = await connectAndReceiveHostOffer();

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'ice-candidate',
            candidate: { candidate: 'other-viewer-candidate' },
            senderId: OTHER_VIEWER_ID,
            timestamp: Date.now(),
          }),
        });
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'ice-candidate',
            candidate: { candidate: 'host-candidate' },
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(peer.addIceCandidate).toHaveBeenCalledTimes(1);
      expect(peer.addIceCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ candidate: 'host-candidate' })
      );
    });

    it('targets outgoing ICE candidates at the host with the subscriber identity', async () => {
      const { peer } = await connectAndReceiveHostOffer();

      const iceListener = peer.addEventListener.mock.calls.find(
        ([eventName]) => eventName === 'icecandidate'
      )?.[1] as ((event: { candidate: { toJSON: () => unknown } | null }) => void) | undefined;
      expect(iceListener).toBeDefined();

      await act(async () => {
        iceListener?.({ candidate: { toJSON: () => ({ candidate: 'local-candidate' }) } });
        await Promise.resolve();
        await Promise.resolve();
      });

      const candidateCall = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => requestBody(init).includes('"type":"ice-candidate"'));
      expect(candidateCall).toBeDefined();
      const body = requestBody(candidateCall?.[1]);
      expect(body).toContain(`"senderId":"${AUTH_USER_ID}"`);
      expect(body).toContain(`"targetId":"${HOST_USER_ID}"`);
    });

    it('refreshes the access token before opening the SSE stream', async () => {
      vi.mocked(getValidAccessToken).mockResolvedValueOnce('refreshed-token');

      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: PARTICIPANT_ROW_ID,
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const [, options] = vi.mocked(createEventSource).mock.calls[0] as [
        string,
        { headers?: Record<string, string> } | undefined,
      ];
      expect(options).toEqual({ headers: { Authorization: 'Bearer refreshed-token' } });
    });

    it("rejects the host's candidates explicitly targeted at another viewer", async () => {
      const { source, peer } = await connectAndReceiveHostOffer();

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'ice-candidate',
            candidate: { candidate: 'for-other-viewer' },
            senderId: HOST_USER_ID,
            targetId: OTHER_VIEWER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(peer.addIceCandidate).not.toHaveBeenCalled();
    });

    it("ignores a known viewer's offer even when it targets us", async () => {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: PARTICIPANT_ROW_ID,
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];

      act(() => {
        source.listeners.get('connected')?.({ data: viewerConnectedEventData() });
        // Server presence marks who is host and who is a fellow viewer
        source.listeners.get('presence-join')?.({
          data: JSON.stringify({
            presences: [
              { user_id: HOST_USER_ID, role: 'host' },
              { user_id: OTHER_VIEWER_ID, role: 'viewer' },
            ],
          }),
        });
      });
      const peer = mockPeerConnections[0];

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'viewer-crafted-offer',
            senderId: OTHER_VIEWER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(peer.setRemoteDescription).not.toHaveBeenCalled();

      // The real host still negotiates normally afterwards
      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'host-offer-sdp',
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
      expect(peer.setRemoteDescription).toHaveBeenCalledWith({
        type: 'offer',
        sdp: 'host-offer-sdp',
      });
    });

    it('does not let an unknown sender displace the host negotiation', async () => {
      const { source, peer } = await connectAndReceiveHostOffer();
      expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'takeover-offer',
            senderId: 'intruder-9999',
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
    });

    it("drains only the negotiated host's early candidates after the offer arrives", async () => {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: PARTICIPANT_ROW_ID,
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];
      act(() => {
        source.listeners.get('connected')?.({ data: viewerConnectedEventData() });
      });
      const peer = mockPeerConnections[0];

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'ice-candidate',
            candidate: { candidate: 'intruder-early' },
            senderId: 'intruder-9999',
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'ice-candidate',
            candidate: { candidate: 'host-early' },
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(peer.addIceCandidate).not.toHaveBeenCalled();

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'host-offer-sdp',
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(peer.addIceCandidate).toHaveBeenCalledTimes(1));
      expect(peer.addIceCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ candidate: 'host-early' })
      );
    });
  });

  describe('credential lifecycle guards', () => {
    const requestBodies = () =>
      vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => (typeof init?.body === 'string' ? init.body : ''));

    it('drops the answer instead of posting once no valid token can be resolved', async () => {
      renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: PARTICIPANT_ROW_ID,
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];
      act(() => {
        source.listeners.get('connected')?.({ data: viewerConnectedEventData() });
      });

      // The account signs out: refresh yields nothing from here on
      vi.mocked(getValidAccessToken).mockResolvedValue(null);

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'host-offer-sdp',
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(requestBodies().some((body) => body.includes('"type":"answer"'))).toBe(false);
    });

    it('does not post the answer when disconnected while the token refresh is in flight', async () => {
      const { result } = renderHook(() =>
        useWebRTCViewer({
          sessionId: 'session-1',
          participantId: PARTICIPANT_ROW_ID,
        })
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const source = mockEventSources[0];
      act(() => {
        source.listeners.get('connected')?.({ data: viewerConnectedEventData() });
      });

      const tokenGate = deferred<string | null>();
      vi.mocked(getValidAccessToken).mockReturnValue(tokenGate.promise);

      await act(async () => {
        source.listeners.get('signal')?.({
          data: JSON.stringify({
            type: 'offer',
            sdp: 'host-offer-sdp',
            senderId: HOST_USER_ID,
            targetId: AUTH_USER_ID,
            timestamp: Date.now(),
          }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        result.current.disconnect();
      });

      await act(async () => {
        tokenGate.resolve('late-token');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(requestBodies().some((body) => body.includes('"type":"answer"'))).toBe(false);
      const headers = vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => JSON.stringify(init?.headers ?? {}));
      expect(headers.some((header) => header.includes('late-token'))).toBe(false);
    });
  });
});
