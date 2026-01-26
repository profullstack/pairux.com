import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

const createParams = (joinCode: string) => ({
  params: Promise.resolve({ joinCode }),
});

describe('GET /api/sessions/join/[joinCode]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns session info for valid join code', async () => {
    const sessionData = {
      id: mockSession.id,
      join_code: 'ABC123',
      status: 'active',
      settings: mockSession.settings,
      created_at: mockSession.created_at,
    };

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: sessionData, error: null }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ count: 2, error: null }),
        };
      }
      return {};
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/sessions/join/ABC123');
    const response = await GET(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.join_code).toBe('ABC123');
    expect(body.data.participant_count).toBe(2);
  });

  it('converts join code to uppercase', async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((field, value) => {
            // Verify it's being called with uppercase
            if (field === 'join_code') {
              expect(value).toBe('ABC123');
            }
            return {
              neq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'test',
                  join_code: 'ABC123',
                  status: 'active',
                  settings: {},
                  created_at: '',
                },
                error: null,
              }),
            };
          }),
        };
      }
      if (table === 'session_participants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ count: 0, error: null }),
        };
      }
      return {};
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/sessions/join/abc123');
    await GET(request, createParams('abc123'));
  });

  it('returns 404 for non-existent or ended session', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Row not found' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/sessions/join/INVALID');
    const response = await GET(request, createParams('INVALID'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found or has ended');
  });

  it('returns 400 on database error', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'OTHER', message: 'Database error' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({ from: mockFrom });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);

    const request = new Request('http://localhost/api/sessions/join/ABC123');
    const response = await GET(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Database error');
  });
});

describe('POST /api/sessions/join/[joinCode]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('joins session as authenticated user', async () => {
    const joinResult = {
      session_id: mockSession.id,
      participant_id: 'participant-123',
    };

    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: joinResult, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(joinResult);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: undefined,
    });
  });

  it('joins session as authenticated user with custom display name', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Custom Name' }),
    });
    await POST(request, createParams('ABC123'));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: 'Custom Name',
    });
  });

  it('joins session as guest with display name', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Guest User' }),
    });
    const response = await POST(request, createParams('ABC123'));

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: 'Guest User',
    });
  });

  it('returns 400 when guest has no display name', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Display name is required for guests');
  });

  it('returns 400 when guest display name is too short', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'X' }),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Display name is required for guests');
  });

  it('returns 400 when RPC fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Session is full' },
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/ABC123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await POST(request, createParams('ABC123'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session is full');
  });

  it('converts join code to uppercase', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions/join/abc123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await POST(request, createParams('abc123'));

    expect(mockSupabase.rpc).toHaveBeenCalledWith('join_session', {
      p_join_code: 'ABC123',
      p_display_name: undefined,
    });
  });
});
