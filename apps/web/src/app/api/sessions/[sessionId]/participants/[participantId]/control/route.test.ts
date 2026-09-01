import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockAdminCreateClient = vi.fn();
const livekitMocks = vi.hoisted(() => {
  const sendData = vi.fn();
  const listParticipants = vi.fn();
  const roomServiceClient = vi.fn(function MockRoomServiceClient() {
    return { sendData, listParticipants };
  });
  return { sendData, listParticipants, roomServiceClient };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockAdminCreateClient(...args),
}));

vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: livekitMocks.roomServiceClient,
  DataPacket_Kind: { RELIABLE: 0 },
}));

import { createClient } from '@/lib/supabase/server';

const createParams = (sessionId: string, participantId: string) => ({
  params: Promise.resolve({ sessionId, participantId }),
});

function createRequest(control_state: 'granted' | 'view-only' | 'requested') {
  return new Request('http://localhost/api/sessions/session-1/participants/p-2/control', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ control_state }),
  });
}

describe('PATCH /api/sessions/[sessionId]/participants/[participantId]/control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    livekitMocks.sendData.mockResolvedValue(undefined);
    // A participant row id is not a LiveKit identity: the desktop client joins
    // as the auth user id, the web client as a generated UUID. The default room
    // here reflects that — the target is present, under a different name.
    livekitMocks.listParticipants.mockResolvedValue([
      { identity: 'host-identity', metadata: JSON.stringify({ userId: 'host-user' }) },
      { identity: 'lk-viewer-identity', metadata: JSON.stringify({ userId: 'viewer-user' }) },
    ]);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.NEXT_PUBLIC_LIVEKIT_URL = 'wss://livekit.example.com';
    process.env.LIVEKIT_API_KEY = 'lk-api-key';
    process.env.LIVEKIT_API_SECRET = 'lk-api-secret';
  });

  it('allows authenticated active participant to grant control', async () => {
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              id: 'session-1',
              host_user_id: 'host-user',
              current_host_id: 'host-user',
              mode: 'sfu',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'participant-self' }, error: null });
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const adminUpdateChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'p-2',
          user_id: 'viewer-user',
          control_state: 'granted',
          display_name: 'Viewer',
        },
        error: null,
      }),
    };
    const adminFrom = vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue(adminUpdateChain),
    });
    mockAdminCreateClient.mockReturnValue({
      from: adminFrom,
    });

    const response = await PATCH(createRequest('granted'), createParams('session-1', 'p-2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.control_state).toBe('granted');
    expect(mockAdminCreateClient).toHaveBeenCalled();
    expect(livekitMocks.roomServiceClient).toHaveBeenCalledWith(
      'https://livekit.example.com',
      'lk-api-key',
      'lk-api-secret'
    );
    expect(livekitMocks.sendData).toHaveBeenCalledTimes(1);
    const firstSendCall = livekitMocks.sendData.mock.calls[0];
    expect(firstSendCall).toBeDefined();
    const [roomName, encodedPayload, kind, options] = firstSendCall!;
    expect(roomName).toBe('session-session-1');
    expect(kind).toBe(0);
    // Addressed to the identity that participant actually joined under, not to
    // their database row id — which matched nobody, in any client, so the
    // signal was silently dropped by the SFU.
    expect(options).toEqual({
      destinationIdentities: ['lk-viewer-identity'],
    });
    // And the payload names the same identity, because the recipient checks a
    // control message is addressed to it before acting on it.
    const payload = JSON.parse(new TextDecoder().decode(encodedPayload as Uint8Array)) as {
      type: string;
      participantId: string;
    };
    expect(payload.type).toBe('control-grant');
    expect(payload.participantId).toBe('lk-viewer-identity');
  });

  it('skips the LiveKit signal when the participant is not in the room', async () => {
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              id: 'session-1',
              host_user_id: 'host-user',
              current_host_id: 'host-user',
              mode: 'sfu',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'participant-self' }, error: null });
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const adminUpdateChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'p-2',
          user_id: 'absent-user',
          control_state: 'granted',
          display_name: 'Viewer',
        },
        error: null,
      }),
    };
    mockAdminCreateClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(adminUpdateChain) }),
    });

    const response = await PATCH(createRequest('granted'), createParams('session-1', 'p-2'));

    // The database write is the source of truth and still stands; there is just
    // nobody connected to signal.
    expect(response.status).toBe(200);
    expect(livekitMocks.sendData).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('rejects non-participant non-host', async () => {
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              id: 'session-1',
              host_user_id: 'host-user',
              current_host_id: 'host-user',
              mode: 'sfu',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await PATCH(createRequest('granted'), createParams('session-1', 'p-2'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Not authorized to manage control in this session');
  });

  it('returns success when LiveKit control signal fails', async () => {
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              id: 'session-1',
              host_user_id: 'host-user',
              current_host_id: 'host-user',
              mode: 'sfu',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: 'participant-self' }, error: null });
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const adminUpdateChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'p-2',
          user_id: 'viewer-user',
          control_state: 'granted',
          display_name: 'Viewer',
        },
        error: null,
      }),
    };
    const adminFrom = vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue(adminUpdateChain),
    });
    mockAdminCreateClient.mockReturnValue({
      from: adminFrom,
    });
    livekitMocks.sendData.mockRejectedValueOnce(new Error('livekit unavailable'));

    const response = await PATCH(createRequest('granted'), createParams('session-1', 'p-2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.control_state).toBe('granted');
    expect(console.error).toHaveBeenCalled();
  });
});
