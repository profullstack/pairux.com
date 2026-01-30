import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebRTCViewer } from './useWebRTCViewer';
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
    user: { id: 'viewer-1', email: 'viewer@example.com' },
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

describe('useWebRTCViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(typeof result.current.sendCursorPosition).toBe('function');
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
});
