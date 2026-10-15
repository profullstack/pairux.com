import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

const SESSION = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT = '22222222-2222-4222-8222-222222222222';

function post(sessionId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/sessions/${sessionId}/connected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) }
  );
}

describe('POST /api/sessions/[sessionId]/connected', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  });

  it('records the activation signal for a guest viewer', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await post(SESSION, { participantId: PARTICIPANT });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('mark_media_connected', {
      p_session_id: SESSION,
      p_participant_id: PARTICIPANT,
    });
  });

  it('lets a signed-in viewer report without a participant row id', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await post(SESSION, {});

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('mark_media_connected', {
      p_session_id: SESSION,
      p_participant_id: null,
    });
  });

  it('refuses someone who is not an active viewer', async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    const response = await post(SESSION, { participantId: PARTICIPANT });

    expect(response.status).toBe(403);
  });

  it('rejects a malformed session id before touching the database', async () => {
    const response = await post('not-a-uuid', {});

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
