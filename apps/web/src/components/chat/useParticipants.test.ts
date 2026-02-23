import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useParticipants } from './useParticipants';
import type { SessionParticipant } from '@pairux/shared-types';

interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Partial<SessionParticipant>;
  old?: Partial<SessionParticipant>;
}

const mockRemoveChannel = vi.fn().mockResolvedValue('ok');
let realtimeCallback: ((payload: RealtimePayload) => void) | null = null;

const mockChannel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn(),
  subscribe: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: vi.fn(() => mockChannel),
    removeChannel: mockRemoveChannel,
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

describe('chat/useParticipants (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeCallback = null;

    mockChannel.on.mockImplementation(
      (_event: string, _filter: unknown, cb: (payload: RealtimePayload) => void) => {
        realtimeCallback = cb;
        return mockChannel;
      }
    );
    mockChannel.subscribe.mockReturnValue(mockChannel);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          session_participants: [
            makeParticipant({ id: 'host', role: 'host', joined_at: '2024-01-01T10:00:00Z' }),
            makeParticipant({ id: 'viewer', joined_at: '2024-01-01T10:01:00Z' }),
            {
              ...makeParticipant({
                id: 'left-user',
                joined_at: '2024-01-01T10:02:00Z',
                left_at: null,
              }),
              role: 'left',
            } as unknown as SessionParticipant,
          ],
        },
      }),
    } as Response);
  });

  it('filters participants marked left by role during initial fetch', async () => {
    const { result } = renderHook(() => useParticipants({ sessionId: 'session-1' }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.participants.map((p) => p.id)).toEqual(['host', 'viewer']);
  });

  it('removes participant on realtime UPDATE when role becomes left', async () => {
    const { result } = renderHook(() => useParticipants({ sessionId: 'session-1' }));

    await waitFor(() => {
      expect(result.current.participants.map((p) => p.id)).toEqual(['host', 'viewer']);
    });

    await act(async () => {
      realtimeCallback?.({
        eventType: 'UPDATE',
        new: {
          ...makeParticipant({
            id: 'viewer',
            joined_at: '2024-01-01T10:01:00Z',
            left_at: null,
          }),
          role: 'left',
        } as unknown as SessionParticipant,
      });
    });

    expect(result.current.participants.map((p) => p.id)).toEqual(['host']);
  });
});
