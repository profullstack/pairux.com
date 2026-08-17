import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebRTCHost } from './useWebRTCHost';
import { createEventSource } from '../lib/event-source';
import { getStoredAuth } from '../lib/secure-storage';
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';

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

const { mockClose, mockAddEventListener } = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockAddEventListener: vi.fn(),
}));

vi.mock('../lib/event-source', () => ({
  createEventSource: vi.fn(() => ({
    addEventListener: mockAddEventListener,
    close: mockClose,
  })),
}));

describe('useWebRTCHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
