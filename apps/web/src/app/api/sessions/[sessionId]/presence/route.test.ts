import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { createMockSupabaseClient } from '@/test/mocks/supabase';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';

const sessionId = '00000000-0000-0000-0000-0000000000a1';
const participantId = '00000000-0000-0000-0000-0000000000b2';

function ping(body: unknown, id = sessionId) {
  return POST(
    new Request(`http://localhost/api/sessions/${id}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId: id }) }
  );
}

describe('POST /api/sessions/[sessionId]/presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims the caller seat and reports it', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'ok', error: null });
    vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient({ rpc }) as never);

    const response = await ping({ participantId });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seat: 'ok' });
    expect(rpc).toHaveBeenCalledWith('claim_session_seat', {
      p_session_id: sessionId,
      p_participant_id: participantId,
    });
  });

  it('passes on a full room without removing anyone', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'participants', error: null });
    vi.mocked(createClient).mockResolvedValue(createMockSupabaseClient({ rpc }) as never);

    const body = await (await ping({})).json();

    expect(body.data).toEqual({ seat: 'participants' });
    expect(rpc).toHaveBeenCalledWith('claim_session_seat', {
      p_session_id: sessionId,
      p_participant_id: null,
    });
  });

  it('rejects a bad session id', async () => {
    const response = await ping({}, 'not-a-uuid');
    expect(response.status).toBe(400);
  });
});
