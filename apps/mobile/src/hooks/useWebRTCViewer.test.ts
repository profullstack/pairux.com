import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebRTCViewer } from './useWebRTCViewer';
import { createEventSource } from '../lib/event-source';
import { getStoredAuth } from '../lib/secure-storage';
import { mediaDevices } from 'react-native-webrtc';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { emitAppStateChange, mockPeerConnections } from '../test/setup';

vi.mock('../config', () => ({
  API_BASE_URL: 'https://pairux.com',
}));

vi.mock('../lib/secure-storage', () => ({
  getStoredAuth: vi.fn().mockResolvedValue({
    accessToken: 'test-token',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3600000,
    user: { id: 'viewer-1', email: 'viewer@example.com' },
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

describe('useWebRTCViewer', () => {
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
      expect.stringContaining('/api/sessions/session-1/signal/stream')
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
      expect.stringContaining('participantId=viewer-42')
    );
  });

  it('should include auth token in SSE URL params', async () => {
    renderHook(() =>
      useWebRTCViewer({
        sessionId: 'session-1',
        participantId: 'viewer-1',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(createEventSource).toHaveBeenCalledWith(expect.stringContaining('token=test-token'));
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
    vi.mocked(getStoredAuth).mockResolvedValueOnce(null);

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
});
