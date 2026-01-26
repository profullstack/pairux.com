import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient, mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

import { createClient } from '@/lib/supabase/server';

const mockChatMessage = {
  id: 'test-message-id',
  session_id: 'test-session-id',
  user_id: 'test-user-id',
  display_name: 'Test User',
  content: 'Hello, world!',
  message_type: 'text',
  created_at: '2024-01-01T00:00:00Z',
};

describe('POST /api/chat/send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends message for authenticated user', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: mockChatMessage, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        content: 'Hello, world!',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual(mockChatMessage);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('send_chat_message', {
      p_session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      p_content: 'Hello, world!',
      p_participant_id: null,
      p_recipient_id: null,
    });
  });

  it('sends message for guest with participantId', async () => {
    const guestMessage = { ...mockChatMessage, user_id: null };
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({ data: guestMessage, error: null }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        content: 'Hello from guest!',
        participantId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual(guestMessage);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('send_chat_message', {
      p_session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      p_content: 'Hello from guest!',
      p_participant_id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
      p_recipient_id: null,
    });
  });

  it('returns 401 for unauthenticated user without participantId', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        content: 'Hello!',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Authentication required or participant ID must be provided');
  });

  it('returns 400 for empty content', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        content: '',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for content exceeding max length', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        content: 'x'.repeat(501),
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid session ID format', async () => {
    const mockSupabase = createMockSupabaseClient({});
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'not-a-uuid',
        content: 'Hello!',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 when RPC fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'User is not a participant in this session' },
      }),
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });

    const request = new Request('http://localhost/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        content: 'Hello!',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('User is not a participant in this session');
  });
});
