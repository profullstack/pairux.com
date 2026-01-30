import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCHost } from './useWebRTCHost';
import { createEventSource } from '../lib/event-source';
import { getStoredAuth } from '../lib/secure-storage';

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
        localStream: null,
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
        localStream: null,
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
        localStream: null,
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
        localStream: null,
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
        localStream: null,
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
        localStream: null,
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
        localStream: null,
      })
    );

    await act(async () => {
      await result.current.startHosting();
    });

    unmount();
    expect(mockClose).toHaveBeenCalled();
  });
});
