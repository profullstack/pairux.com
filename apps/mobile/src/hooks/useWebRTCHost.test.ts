import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebRTCHost } from './useWebRTCHost';
import { createEventSource } from '../lib/event-source';
import { getStoredAuth } from '../lib/secure-storage';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { emitAppStateChange } from '../test/setup';

vi.mock('../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

vi.mock('../lib/secure-storage', () => ({
  getStoredAuth: vi.fn().mockResolvedValue({
    accessToken: 'test-token',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3600000,
    user: { id: 'host-1', email: 'host@example.com' },
  }),
  isAuthExpired: vi.fn().mockReturnValue(false),
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
  createEventSource: vi.fn(() => {
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
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    } as Response);
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
      expect.stringContaining('/api/sessions/session-1/signal/stream')
    );
  });

  it('should set error when not authenticated', async () => {
    vi.mocked(getStoredAuth).mockResolvedValueOnce(null);

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
});
