import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from './useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty notifications', () => {
    const { result } = renderHook(() => useNotifications());

    expect(result.current.notifications).toHaveLength(0);
  });

  it('adds a notification', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({
        type: 'control-request',
        viewerId: 'viewer-1',
        displayName: 'Test User',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]).toMatchObject({
      type: 'control-request',
      viewerId: 'viewer-1',
      displayName: 'Test User',
    });
  });

  it('returns notification id when adding', () => {
    const { result } = renderHook(() => useNotifications());

    let id = '';
    act(() => {
      id = result.current.addNotification({
        type: 'control-request',
        viewerId: 'viewer-1',
        displayName: 'Test User',
      });
    });

    expect(id).toBeDefined();
    expect(result.current.notifications[0]?.id).toBe(id);
  });

  it('removes a notification by id', () => {
    const { result } = renderHook(() => useNotifications());

    let id = '';
    act(() => {
      id = result.current.addNotification({
        type: 'control-request',
        viewerId: 'viewer-1',
        displayName: 'Test User',
      });
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      result.current.removeNotification(id);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('clears all notifications', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({
        type: 'control-request',
        viewerId: 'viewer-1',
        displayName: 'User 1',
      });
      result.current.addNotification({
        type: 'participant-joined',
        participantId: 'p-1',
        displayName: 'User 2',
      });
    });

    expect(result.current.notifications).toHaveLength(2);

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('does not auto-dismiss control-request notifications', () => {
    const { result } = renderHook(() => useNotifications({ autoDismissMs: 1000 }));

    act(() => {
      result.current.addNotification({
        type: 'control-request',
        viewerId: 'viewer-1',
        displayName: 'Test User',
      });
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Control requests should NOT auto-dismiss
    expect(result.current.notifications).toHaveLength(1);
  });

  it('auto-dismisses non-control-request notifications', () => {
    const { result } = renderHook(() => useNotifications({ autoDismissMs: 1000 }));

    act(() => {
      result.current.addNotification({
        type: 'participant-joined',
        participantId: 'p-1',
        displayName: 'Test User',
      });
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('limits to max notifications', () => {
    const { result } = renderHook(() => useNotifications({ maxNotifications: 2 }));

    act(() => {
      result.current.addNotification({
        type: 'participant-joined',
        participantId: 'p-1',
        displayName: 'User 1',
      });
      result.current.addNotification({
        type: 'participant-joined',
        participantId: 'p-2',
        displayName: 'User 2',
      });
      result.current.addNotification({
        type: 'participant-joined',
        participantId: 'p-3',
        displayName: 'User 3',
      });
    });

    expect(result.current.notifications).toHaveLength(2);
    // Should have the most recent two
    expect(result.current.notifications[0]?.displayName).toBe('User 2');
    expect(result.current.notifications[1]?.displayName).toBe('User 3');
  });

  it('adds timestamp to notifications', () => {
    const { result } = renderHook(() => useNotifications());
    const beforeTime = Date.now();

    act(() => {
      result.current.addNotification({
        type: 'control-request',
        viewerId: 'viewer-1',
        displayName: 'Test User',
      });
    });

    const afterTime = Date.now();
    const notification = result.current.notifications[0];

    expect(notification).toBeDefined();
    expect(notification?.timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(notification?.timestamp).toBeLessThanOrEqual(afterTime);
  });
});
