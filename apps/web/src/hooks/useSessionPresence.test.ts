import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPresence } from './useSessionPresence';

// Mock supabase client
const mockRemoveChannel = vi.fn().mockResolvedValue('ok');
let subscribeCallback: ((payload: { new: Record<string, unknown> }) => void) | null = null;

const mockChannel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn(),
  subscribe: vi.fn(),
};

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    channel: vi.fn(() => mockChannel),
    removeChannel: mockRemoveChannel,
  }),
}));

/** Flush microtasks so the initial .then() fetch resolves */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setupMocks() {
  subscribeCallback = null;

  mockChannel.on.mockImplementation(
    (
      _event: string,
      _filter: unknown,
      callback: (payload: { new: Record<string, unknown> }) => void
    ) => {
      subscribeCallback = callback;
      return mockChannel;
    }
  );
  mockChannel.subscribe.mockReturnValue(mockChannel);

  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { status: 'active', current_host_id: 'host-123' },
      error: null,
    }),
  });
}

describe('useSessionPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useSessionPresence('session-1'));

    expect(result.current.status).toBe('created');
    expect(result.current.currentHostId).toBeNull();
    expect(result.current.hostOnline).toBe(false);
  });

  it('should fetch initial session data', async () => {
    renderHook(() => useSessionPresence('session-1'));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(mockFrom).toHaveBeenCalledWith('sessions');
  });

  it('should update state from initial fetch', async () => {
    const { result } = renderHook(() => useSessionPresence('session-1'));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.status).toBe('active');
    expect(result.current.currentHostId).toBe('host-123');
    expect(result.current.hostOnline).toBe(true);
  });

  it('should subscribe to real-time changes', () => {
    renderHook(() => useSessionPresence('session-1'));

    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
        filter: 'id=eq.session-1',
      }),
      expect.any(Function)
    );
    expect(mockChannel.subscribe).toHaveBeenCalled();
  });

  it('should update state when real-time update received', async () => {
    const { result } = renderHook(() => useSessionPresence('session-1'));

    // Wait for initial fetch to settle first
    await act(async () => {
      await flushMicrotasks();
    });

    // Now simulate real-time update: host left
    await act(async () => {
      subscribeCallback?.({
        new: { status: 'paused', current_host_id: null },
      });
    });

    expect(result.current.status).toBe('paused');
    expect(result.current.currentHostId).toBeNull();
    expect(result.current.hostOnline).toBe(false);
  });

  it('should detect host coming back online', async () => {
    const { result } = renderHook(() => useSessionPresence('session-1'));

    // Wait for initial fetch to settle
    await act(async () => {
      await flushMicrotasks();
    });

    // First: host leaves
    await act(async () => {
      subscribeCallback?.({
        new: { status: 'paused', current_host_id: null },
      });
    });

    expect(result.current.hostOnline).toBe(false);

    // Then: host returns
    await act(async () => {
      subscribeCallback?.({
        new: { status: 'active', current_host_id: 'host-123' },
      });
    });

    expect(result.current.hostOnline).toBe(true);
    expect(result.current.status).toBe('active');
  });

  it('should cleanup channel on unmount', () => {
    const { unmount } = renderHook(() => useSessionPresence('session-1'));

    unmount();

    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it('should handle session in created state (no host yet)', async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { status: 'created', current_host_id: null },
        error: null,
      }),
    });

    const { result } = renderHook(() => useSessionPresence('session-new'));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.status).toBe('created');
    expect(result.current.currentHostId).toBeNull();
    expect(result.current.hostOnline).toBe(false);
  });
});
