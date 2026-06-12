import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockStopEgress = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@/lib/livekit-egress', () => ({
  getEgressClient: () => ({
    stopEgress: mockStopEgress,
  }),
}));

function createRequest(body: unknown) {
  return new Request('http://localhost/api/stream/egress/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
  mockStopEgress.mockResolvedValue(undefined);
});

describe('POST /api/stream/egress/stop', () => {
  it('rejects unauthenticated requests', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });
    const res = await POST(createRequest({ egressId: 'eg-1' }));
    expect(res.status).toBe(401);
    expect(mockStopEgress).not.toHaveBeenCalled();
  });

  it('requires an egressId', async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  it('stops the egress', async () => {
    const res = await POST(createRequest({ egressId: 'eg-123' }));
    expect(res.status).toBe(200);
    expect(mockStopEgress).toHaveBeenCalledWith('eg-123');
  });
});
