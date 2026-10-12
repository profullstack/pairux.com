import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAddGrant = vi.fn();
const mockCtor = vi.fn();
const mockList = vi.fn();
vi.mock('livekit-server-sdk', () => ({
  AccessToken: vi.fn().mockImplementation((...args: unknown[]) => {
    mockCtor(...args);
    return { addGrant: mockAddGrant, toJwt: () => Promise.resolve('jwt') };
  }),
  RoomServiceClient: vi.fn().mockImplementation(() => ({ listParticipants: mockList })),
}));
vi.mock('@/lib/ice-servers', () => ({
  getIceServers: () => Promise.resolve([{ urls: 'turn:turn.pairux.com:3478' }]),
}));

const ROOM = 'AbCdEfGhIjKlMnOpQrStUv';
const req = (body: unknown, ip = '203.0.113.1') =>
  new Request('https://pairux.com/api/v1/rooms/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv('LIVEKIT_API_KEY', 'k');
  vi.stubEnv('LIVEKIT_API_SECRET', 's');
  vi.stubEnv('NEXT_PUBLIC_LIVEKIT_URL', 'wss://sfu.pairux.com');
  mockAddGrant.mockClear();
  mockCtor.mockClear();
  mockList.mockReset().mockResolvedValue([]);
});

describe('POST /api/v1/rooms/token', () => {
  it('mints a token for the anon- room with a random identity and no account', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ room: ROOM, name: 'Alice' }, '203.0.113.2'));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toMatchObject({ token: 'jwt', roomName: `anon-${ROOM}`, e2ee: true });
    expect(mockAddGrant).toHaveBeenCalledWith(
      expect.objectContaining({ room: `anon-${ROOM}`, roomJoin: true })
    );
    const opts = mockCtor.mock.calls[0]?.[2] as { identity: string; name: string };
    expect(opts.identity).toMatch(/^anon:[0-9a-f-]{36}$/);
    expect(opts.name).toBe('Alice');
  });

  it('rejects a guessable room id', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ room: 'abc', name: 'Alice' }, '203.0.113.3'));
    expect(res.status).toBe(400);
    expect(mockAddGrant).not.toHaveBeenCalled();
  });

  it('turns people away from a full room', async () => {
    mockList.mockResolvedValue(Array.from({ length: 16 }, () => ({})));
    const { POST } = await import('./route');
    const res = await POST(req({ room: ROOM, name: 'Alice' }, '203.0.113.4'));
    expect(res.status).toBe(409);
  });

  it('treats a room LiveKit has not created yet as empty', async () => {
    mockList.mockRejectedValue(new Error('requested room does not exist'));
    const { POST } = await import('./route');
    const res = await POST(req({ room: ROOM, name: 'Alice' }, '203.0.113.5'));
    expect(res.status).toBe(200);
  });

  it('rate-limits one address', async () => {
    const { POST } = await import('./route');
    let last = 200;
    for (let i = 0; i < 21; i++) {
      last = (await POST(req({ room: ROOM, name: 'A' }, '203.0.113.9'))).status;
    }
    expect(last).toBe(429);
  });
});
