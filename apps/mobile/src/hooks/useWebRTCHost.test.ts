import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';
import { useWebRTCHost } from './useWebRTCHost';
import { createEventSource } from '../lib/event-source';
import { getValidAccessToken } from '../lib/auth-session';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { emitAppStateChange, mockPeerConnections } from '../test/setup';
import { runAndroidNativePrompt } from '../lib/android-native-prompt';
import { hostConnectedEventData, HOST_USER_ID } from '../test/fixtures/server-contracts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

describe('useWebRTCHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSources.length = 0;
    vi.mocked(getValidAccessToken).mockResolvedValue('test-token');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    } as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    expect(result.current.isHosting).toBe(false);
    expect(result.current.viewerCount).toBe(0);
    expect(result.current.viewers.size).toBe(0);
    expect(result.current.controllingViewer).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.micEnabled).toBe(false);
    expect(result.current.hasMic).toBe(false);
  });

  it('should expose all required API methods', () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    expect(typeof result.current.startHosting).toBe('function');
    expect(typeof result.current.stopHosting).toBe('function');
    expect(typeof result.current.publishStream).toBe('function');
    expect(typeof result.current.unpublishStream).toBe('function');
    expect(typeof result.current.grantControl).toBe('function');
    expect(typeof result.current.revokeControl).toBe('function');
    expect(typeof result.current.kickViewer).toBe('function');
    expect(typeof result.current.muteViewer).toBe('function');
    expect(typeof result.current.toggleMic).toBe('function');
  });

  it('should start hosting and create SSE connection', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    expect(createEventSource).toHaveBeenCalledWith(
      expect.stringContaining('/api/sessions/session-1/signal/stream'),
      expect.anything()
    );
  });

  it('should set error when not authenticated', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    expect(result.current.error).toBe('Not authenticated. Please log in again.');
    expect(result.current.isHosting).toBe(false);
  });

  it('should stop hosting and clean up resources', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    act(() => {
      result.current.stopHosting();
    });

    expect(mockClose).toHaveBeenCalled();
    expect(result.current.isHosting).toBe(false);
    expect(result.current.viewerCount).toBe(0);
  });

  it('should not double-start hosting', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    await act(async () => {
      await result.current.startHosting();
    });

    // Should only be called once
    expect(createEventSource).toHaveBeenCalledTimes(1);
  });

  it('should clean up on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    unmount();
    expect(mockClose).toHaveBeenCalled();
  });

  it('removes only screen-share senders when unpublishing', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const presenceJoinListener = mockAddEventListener.mock.calls.find(
      ([eventName]) => eventName === 'presence-join'
    )?.[1] as ((event: { data: string }) => void) | undefined;
    act(() => {
      presenceJoinListener?.({
        data: JSON.stringify({ presences: [{ user_id: 'viewer-1', role: 'viewer' }] }),
      });
    });
    await waitFor(() => expect(result.current.viewerCount).toBe(1));

    const viewer = result.current.viewers.get('viewer-1');
    expect(viewer).toBeDefined();
    const screenTrack = {
      id: 'screen',
      kind: 'video',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const screenStream = { getTracks: () => [screenTrack] } as unknown as MediaStream;

    await act(async () => {
      await result.current.publishStream(screenStream);
    });
    const screenSender = viewer?.peerConnection
      .getSenders()
      .find((sender) => sender.track === screenTrack);
    expect(screenSender).toBeDefined();

    await act(async () => {
      await result.current.unpublishStream();
    });

    expect(viewer?.peerConnection.removeTrack).toHaveBeenCalledWith(screenSender);
    expect(viewer?.peerConnection.getSenders()).not.toContain(screenSender);
    expect(
      viewer?.peerConnection.getSenders().some((sender) => sender.track?.kind === 'audio')
    ).toBe(true);
  });

  it('does not add a duplicate sender when the same stream is published twice', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const presenceJoinListener = mockAddEventListener.mock.calls.find(
      ([eventName]) => eventName === 'presence-join'
    )?.[1] as ((event: { data: string }) => void) | undefined;
    act(() => {
      presenceJoinListener?.({
        data: JSON.stringify({ presences: [{ user_id: 'viewer-1', role: 'viewer' }] }),
      });
    });
    await waitFor(() => expect(result.current.viewerCount).toBe(1));

    const viewer = result.current.viewers.get('viewer-1');
    const screenTrack = {
      id: 'screen',
      kind: 'video',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const screenStream = { getTracks: () => [screenTrack] } as unknown as MediaStream;

    await act(async () => {
      await result.current.publishStream(screenStream);
      await result.current.publishStream(screenStream);
    });

    const screenSenders = viewer?.peerConnection
      .getSenders()
      .filter((sender) => sender.track === screenTrack);
    expect(screenSenders).toHaveLength(1);
  });

  it('rejects publishing and rolls back its sender when signaling fails', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const presenceJoinListener = mockAddEventListener.mock.calls.find(
      ([eventName]) => eventName === 'presence-join'
    )?.[1] as ((event: { data: string }) => void) | undefined;
    act(() => {
      presenceJoinListener?.({
        data: JSON.stringify({ presences: [{ user_id: 'viewer-1', role: 'viewer' }] }),
      });
    });
    await waitFor(() => expect(result.current.viewerCount).toBe(1));

    const viewer = result.current.viewers.get('viewer-1');
    const screenTrack = {
      id: 'screen',
      kind: 'video',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const screenStream = { getTracks: () => [screenTrack] } as unknown as MediaStream;
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      text: async () => 'signaling unavailable',
    } as Response);

    await act(async () => {
      await expect(result.current.publishStream(screenStream)).rejects.toThrow(
        'Failed to signal viewer viewer-1'
      );
    });

    expect(viewer?.peerConnection.getSenders().some((sender) => sender.track === screenTrack)).toBe(
      false
    );
  });

  it('tears down once in the background and resumes exactly once when active', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
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

  it('keeps hosting through the transient background event from an Android prompt', async () => {
    Object.assign(Platform, { OS: 'android', Version: 34 });
    let resolvePrompt!: () => void;
    const promptAction = new Promise<void>((resolve) => {
      resolvePrompt = resolve;
    });
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const prompt = runAndroidNativePrompt(() => promptAction);

    act(() => {
      emitAppStateChange('background');
    });
    expect(mockClose).not.toHaveBeenCalled();

    await act(async () => {
      resolvePrompt();
      emitAppStateChange('active');
      await prompt;
    });

    expect(mockClose).not.toHaveBeenCalled();
    expect(createEventSource).toHaveBeenCalledTimes(1);
  });

  it('suspends hosting when Android stays backgrounded after a prompt settles', async () => {
    vi.useFakeTimers();
    Object.assign(Platform, { OS: 'android', Version: 34 });
    const promptAction = deferred<undefined>();
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    act(() => {
      mockEventSources[0]?.listeners.get('connected')?.({ data: '{}' });
    });
    expect(result.current.isHosting).toBe(true);
    const prompt = runAndroidNativePrompt(() => promptAction.promise);

    act(() => {
      emitAppStateChange('background');
    });
    expect(mockClose).not.toHaveBeenCalled();

    await act(async () => {
      promptAction.resolve(undefined);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(prompt).resolves.toMatchObject({ resumed: false });
    });

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(result.current.isHosting).toBe(false);
  });

  it('accepts a viewer presence event during a transient inactive window', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const source = mockEventSources[0];
    expect(source).toBeDefined();

    act(() => {
      source.listeners.get('connected')?.({ data: '{}' });
      emitAppStateChange('inactive');
    });
    await act(async () => {
      source.listeners.get('presence-join')?.({
        data: JSON.stringify({ presences: [{ user_id: 'viewer-1', role: 'viewer' }] }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.viewerCount).toBe(1));
    expect(result.current.viewers.has('viewer-1')).toBe(true);
    expect(source.close).not.toHaveBeenCalled();
  });

  it('starts on foreground when hosting was requested while inactive', async () => {
    emitAppStateChange('inactive');
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    expect(createEventSource).not.toHaveBeenCalled();

    await act(async () => {
      emitAppStateChange('active');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createEventSource).toHaveBeenCalledTimes(1);
  });

  it('does not stop a caller-owned screen stream when hosting stops', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );
    await act(async () => {
      await result.current.startHosting();
    });

    const screenTrack = {
      id: 'screen',
      kind: 'video',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
    const screenStream = { getTracks: () => [screenTrack] } as unknown as MediaStream;
    await act(async () => {
      await result.current.publishStream(screenStream);
    });

    act(() => {
      result.current.stopHosting();
    });

    expect(screenTrack.stop).not.toHaveBeenCalled();
  });

  it('ignores presence callbacks from a retired background generation', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const stalePresenceListener = mockEventSources[0]?.listeners.get('presence-join');

    act(() => {
      emitAppStateChange('background');
    });
    await act(async () => {
      emitAppStateChange('active');
      await Promise.resolve();
      await Promise.resolve();
    });
    const currentPresenceListener = mockEventSources[1]?.listeners.get('presence-join');

    await act(async () => {
      stalePresenceListener?.({
        data: JSON.stringify({ presences: [{ user_id: 'stale-viewer', role: 'viewer' }] }),
      });
      await Promise.resolve();
    });
    expect(result.current.viewerCount).toBe(0);

    act(() => {
      currentPresenceListener?.({
        data: JSON.stringify({ presences: [{ user_id: 'current-viewer', role: 'viewer' }] }),
      });
    });
    await waitFor(() => expect(result.current.viewerCount).toBe(1));
    expect(result.current.viewers.has('current-viewer')).toBe(true);
  });

  it('preserves the host microphone mute intent across a foreground reconnect', async () => {
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
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
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

  it('stops a late microphone stream when unmounted during startup', async () => {
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

    const { result, unmount } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    let startPromise!: Promise<void>;
    await act(async () => {
      startPromise = result.current.startHosting();
      await Promise.resolve();
    });
    unmount();

    await act(async () => {
      resolveMic(lateStream);
      await startPromise;
    });

    expect(lateTrack.stop).toHaveBeenCalledTimes(1);
    expect(createEventSource).not.toHaveBeenCalled();
  });

  it('restarts once after the SSE heartbeat expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));

    try {
      const { result } = renderHook(() =>
        useWebRTCHost({
          sessionId: 'session-1',
          hostId: 'host-1',
        })
      );

      await act(async () => {
        await result.current.startHosting();
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

  it('sends the SSE bearer token in the Authorization header, not the URL', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-1',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    const [url, options] = vi.mocked(createEventSource).mock.calls[0] as [
      string,
      { headers?: Record<string, string> } | undefined,
    ];
    expect(url).not.toContain('token=');
    expect(options).toEqual({ headers: { Authorization: 'Bearer test-token' } });
  });

  it('signs offers with the server-assigned subscriberId, not the local hostId', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-local-id',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const source = mockEventSources[0];
    expect(source).toBeDefined();

    act(() => {
      // The server identifies the authenticated host by its auth user id
      source.listeners.get('connected')?.({ data: hostConnectedEventData() });
    });

    await act(async () => {
      source.listeners.get('presence-join')?.({
        data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const requestBody = (init?: RequestInit): string =>
      typeof init?.body === 'string' ? init.body : '';
    const offerCall = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => requestBody(init).includes('"type":"offer"'));
    expect(offerCall).toBeDefined();
    const body = requestBody(offerCall?.[1]);
    expect(body).toContain(`"senderId":"${HOST_USER_ID}"`);
    expect(body).toContain('"targetId":"viewer-sub-1"');
    expect(body).not.toContain('host-local-id');
  });

  it('ignores answers addressed to a different subscriber', async () => {
    const { result } = renderHook(() =>
      useWebRTCHost({
        sessionId: 'session-1',
        hostId: 'host-local-id',
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });
    const source = mockEventSources[0];

    act(() => {
      source.listeners.get('connected')?.({ data: hostConnectedEventData() });
    });
    await act(async () => {
      source.listeners.get('presence-join')?.({
        data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.viewerCount).toBe(1));

    const viewer = result.current.viewers.get('viewer-sub-1');
    expect(viewer).toBeDefined();
    (viewer!.peerConnection as unknown as { signalingState: string }).signalingState =
      'have-local-offer';

    // Targeted at some other subscriber: must not touch our peer connection
    await act(async () => {
      source.listeners.get('signal')?.({
        data: JSON.stringify({
          type: 'answer',
          sdp: 'answer-sdp',
          senderId: 'viewer-sub-1',
          targetId: 'someone-else',
          timestamp: Date.now(),
        }),
      });
      await Promise.resolve();
    });
    expect(viewer!.peerConnection.setRemoteDescription).not.toHaveBeenCalled();

    // Targeted at our server-assigned subscriber id: processed
    await act(async () => {
      source.listeners.get('signal')?.({
        data: JSON.stringify({
          type: 'answer',
          sdp: 'answer-sdp',
          senderId: 'viewer-sub-1',
          targetId: HOST_USER_ID,
          timestamp: Date.now(),
        }),
      });
      await Promise.resolve();
    });
    expect(viewer!.peerConnection.setRemoteDescription).toHaveBeenCalledWith({
      type: 'answer',
      sdp: 'answer-sdp',
    });
  });

  it('posts the host liveness heartbeat while hosting and stops with it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));

    const heartbeatCalls = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url]) => typeof url === 'string' && url.includes('/api/sessions/session-1/heartbeat')
        ).length;

    try {
      const { result } = renderHook(() =>
        useWebRTCHost({
          sessionId: 'session-1',
          hostId: 'host-1',
        })
      );

      await act(async () => {
        await result.current.startHosting();
      });
      expect(heartbeatCalls()).toBe(0);

      await act(async () => {
        mockEventSources[0]?.listeners.get('connected')?.({ data: hostConnectedEventData() });
        await vi.advanceTimersByTimeAsync(0);
      });
      // Stamped immediately so the room appears live without a 30s wait
      expect(heartbeatCalls()).toBe(1);
      expect(fetch).toHaveBeenCalledWith(
        'https://pairux.com/api/sessions/session-1/heartbeat',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(heartbeatCalls()).toBe(2);

      act(() => {
        result.current.stopHosting();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(heartbeatCalls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('credential lifecycle guards', () => {
    const requestBodies = () =>
      vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => (typeof init?.body === 'string' ? init.body : ''));

    it('drops signals instead of posting once no valid token can be resolved', async () => {
      const { result } = renderHook(() =>
        useWebRTCHost({
          sessionId: 'session-1',
          hostId: 'host-1',
        })
      );
      await act(async () => {
        await result.current.startHosting();
      });
      const source = mockEventSources[0];
      act(() => {
        source.listeners.get('connected')?.({ data: hostConnectedEventData() });
      });

      // The account signs out: refresh yields nothing from here on
      vi.mocked(getValidAccessToken).mockResolvedValue(null);

      await act(async () => {
        source.listeners.get('presence-join')?.({
          data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The offer for the joining viewer must not be posted with any
      // previously cached credential
      expect(requestBodies().some((body) => body.includes('"type":"offer"'))).toBe(false);
    });

    it('does not signal after hosting stops while the token refresh is in flight', async () => {
      const { result } = renderHook(() =>
        useWebRTCHost({
          sessionId: 'session-1',
          hostId: 'host-1',
        })
      );
      await act(async () => {
        await result.current.startHosting();
      });
      const source = mockEventSources[0];
      act(() => {
        source.listeners.get('connected')?.({ data: hostConnectedEventData() });
      });

      const tokenGate = deferred<string | null>();
      vi.mocked(getValidAccessToken).mockReturnValue(tokenGate.promise);

      await act(async () => {
        source.listeners.get('presence-join')?.({
          data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      act(() => {
        result.current.stopHosting();
      });

      await act(async () => {
        tokenGate.resolve('late-token');
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(requestBodies().some((body) => body.includes('"type":"offer"'))).toBe(false);
      const headers = vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => JSON.stringify(init?.headers ?? {}));
      expect(headers.some((header) => header.includes('late-token'))).toBe(false);
    });
  });

  it('keeps the published screen-share stream across an automatic SSE-error restart', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useWebRTCHost({
          sessionId: 'session-1',
          hostId: 'host-1',
        })
      );
      await act(async () => {
        await result.current.startHosting();
      });
      const source = mockEventSources[0];
      act(() => {
        source.listeners.get('connected')?.({ data: hostConnectedEventData() });
      });
      await act(async () => {
        source.listeners.get('presence-join')?.({
          data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
        });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.viewerCount).toBe(1);

      const screenTrack = {
        id: 'screen',
        kind: 'video',
        stop: vi.fn(),
      } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
      const screenStream = { getTracks: () => [screenTrack] } as unknown as MediaStream;
      await act(async () => {
        await result.current.publishStream(screenStream);
      });

      // Transient transport error: the hook rebuilds the SSE after 3s
      await act(async () => {
        source.listeners.get('error')?.({ data: '' });
        await vi.advanceTimersByTimeAsync(3_100);
      });
      expect(mockEventSources).toHaveLength(2);
      const rebuiltSource = mockEventSources[1];

      act(() => {
        rebuiltSource.listeners.get('connected')?.({ data: hostConnectedEventData() });
      });
      const pcCountBefore = mockPeerConnections.length;
      await act(async () => {
        rebuiltSource.listeners.get('presence-join')?.({
          data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
        });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockPeerConnections.length).toBe(pcCountBefore + 1);
      const rebuiltPc = mockPeerConnections[mockPeerConnections.length - 1];

      // The still-live capture re-attaches: no re-publish, no new capture
      // permission prompt, and the caller-owned track is never stopped
      expect(rebuiltPc.addTrack).toHaveBeenCalledWith(screenTrack, screenStream);
      expect(screenTrack.stop).not.toHaveBeenCalled();

      // A user-initiated stop still clears the published stream
      act(() => {
        result.current.stopHosting();
      });
      await act(async () => {
        await result.current.startHosting();
      });
      const freshSource = mockEventSources[2];
      act(() => {
        freshSource.listeners.get('connected')?.({ data: hostConnectedEventData() });
      });
      await act(async () => {
        freshSource.listeners.get('presence-join')?.({
          data: JSON.stringify({ presences: [{ user_id: 'viewer-sub-1', role: 'viewer' }] }),
        });
        await vi.advanceTimersByTimeAsync(0);
      });
      const freshPc = mockPeerConnections[mockPeerConnections.length - 1];
      expect(freshPc.addTrack).not.toHaveBeenCalledWith(screenTrack, expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});
