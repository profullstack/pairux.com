import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionParticipant } from '@pairux/shared-types';
import { useParticipants } from './useParticipants';

const mockInvoke = vi.fn();

vi.mock('@/lib/ipc', () => ({
  getElectronAPI: () => ({
    invoke: mockInvoke,
  }),
}));

function makeParticipant(
  overrides: Partial<SessionParticipant> & Pick<SessionParticipant, 'id' | 'joined_at'>
): SessionParticipant {
  return {
    id: overrides.id,
    session_id: overrides.session_id ?? 'session-1',
    user_id: overrides.user_id ?? null,
    display_name: overrides.display_name ?? overrides.id,
    role: overrides.role ?? 'viewer',
    control_state: overrides.control_state ?? 'view-only',
    is_backup_host: overrides.is_backup_host ?? false,
    joined_at: overrides.joined_at,
    left_at: overrides.left_at ?? null,
    last_seen_at: overrides.last_seen_at ?? null,
    connection_status: overrides.connection_status ?? 'connected',
  } as SessionParticipant;
}

describe('chat/useParticipants (desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters role=left participants and refreshes on polling', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        success: true,
        participants: [
          makeParticipant({ id: 'host', role: 'host', joined_at: '2024-01-01T10:00:00Z' }),
          makeParticipant({ id: 'viewer', joined_at: '2024-01-01T10:01:00Z' }),
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        participants: [
          makeParticipant({ id: 'host', role: 'host', joined_at: '2024-01-01T10:00:00Z' }),
          makeParticipant({
            id: 'viewer',
            joined_at: '2024-01-01T10:01:00Z',
            left_at: '2024-01-01T10:05:00Z',
          }),
        ],
      });

    const { result, unmount } = renderHook(() => useParticipants({ sessionId: 'session-1' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.participants.map((p) => p.id)).toEqual(['host', 'viewer']);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(result.current.participants.map((p) => p.id)).toEqual(['host']);

    unmount();
  });
});
