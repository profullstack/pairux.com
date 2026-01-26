import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';
import { createMockSupabaseClient, mockUser, mockSession } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

describe('POST /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates session for authenticated user with default mode', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual(mockSession);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_session', {
      p_settings: {
        quality: 'medium',
        allowControl: false,
        maxParticipants: 5,
      },
      p_mode: 'p2p',
    });
  });

  it('creates session with custom settings', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allowGuestControl: true,
        maxParticipants: 3,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_session', {
      p_settings: {
        quality: 'medium',
        allowControl: true,
        maxParticipants: 3,
      },
      p_mode: 'p2p',
    });
  });

  it('creates session with SFU mode', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'sfu',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_session', {
      p_settings: {
        quality: 'medium',
        allowControl: false,
        maxParticipants: 5,
      },
      p_mode: 'sfu',
    });
  });

  it('returns 401 for unauthenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when RPC fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Session limit reached' },
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session limit reached');
  });

  it('returns 400 for invalid maxParticipants', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxParticipants: 20 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

describe('GET /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('lists sessions for authenticated user', async () => {
    const sessions = [mockSession, { ...mockSession, id: 'session-2' }];
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: sessions, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(sessions);
  });

  it('returns 401 for unauthenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 on database error', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Database error');
  });
});
