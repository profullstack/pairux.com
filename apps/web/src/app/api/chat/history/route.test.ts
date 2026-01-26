import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

const mockMessages = [
  {
    id: 'msg-1',
    session_id: 'test-session-id',
    user_id: 'test-user-id',
    display_name: 'Test User',
    content: 'Hello!',
    message_type: 'text',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'msg-2',
    session_id: 'test-session-id',
    user_id: null,
    display_name: 'Guest User',
    content: 'Hi there!',
    message_type: 'text',
    created_at: '2024-01-01T00:01:00Z',
  },
  {
    id: 'msg-3',
    session_id: 'test-session-id',
    user_id: null,
    display_name: 'System',
    content: 'Guest User joined the session',
    message_type: 'system',
    created_at: '2024-01-01T00:00:30Z',
  },
];

describe('GET /api/chat/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns chat history for authenticated user', async () => {
    // DB returns newest first (reverse chronological)
    const reversedMessages = [...mockMessages].reverse();

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: reversedMessages, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/history?sessionId=${sessionId}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.messages).toHaveLength(3);
    expect(body.data.hasMore).toBe(false);
    expect(mockFrom).toHaveBeenCalledWith('chat_messages');
  });

  it('returns messages in chronological order', async () => {
    // Create messages with clear timestamps for ordering
    const orderedMockMessages = [
      { ...mockMessages[0], id: 'msg-oldest', created_at: '2024-01-01T00:00:00Z' },
      { ...mockMessages[1], id: 'msg-middle', created_at: '2024-01-01T00:01:00Z' },
      { ...mockMessages[2], id: 'msg-newest', created_at: '2024-01-01T00:02:00Z' },
    ];
    // Simulate DB returning in reverse order (newest first)
    const reversedMessages = [...orderedMockMessages].reverse();

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: reversedMessages, error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/history?sessionId=${sessionId}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Messages should be reversed back to chronological order (oldest first)
    expect(body.data.messages[0].id).toBe('msg-oldest');
    expect(body.data.messages[1].id).toBe('msg-middle');
    expect(body.data.messages[2].id).toBe('msg-newest');
  });

  it('supports pagination with before parameter', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: [mockMessages[0]], error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const before = '2024-01-01T00:00:30Z';
    const request = new Request(
      `http://localhost/api/chat/history?sessionId=${sessionId}&before=${before}`
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.messages).toHaveLength(1);
  });

  it('supports custom limit parameter', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: mockMessages.slice(0, 2), error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/history?sessionId=${sessionId}&limit=2`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.hasMore).toBe(true);
  });

  it('returns 400 for invalid session ID', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/history?sessionId=invalid');

    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for missing session ID', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/history');

    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for limit out of range', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(
      `http://localhost/api/chat/history?sessionId=${sessionId}&limit=200`
    );

    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns empty array for session with no messages', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/history?sessionId=${sessionId}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.messages).toEqual([]);
    expect(body.data.hasMore).toBe(false);
  });

  it('returns 400 on database error', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      }),
    });

    const mockSupabase = createMockSupabaseClient({
      from: mockFrom,
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const request = new Request(`http://localhost/api/chat/history?sessionId=${sessionId}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Database error');
  });
});
