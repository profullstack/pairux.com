import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPartnerKey, partnersFromEnv, authenticatePartner } from '@/lib/partners';

const mockAddGrant = vi.fn();
const mockCtor = vi.fn();
vi.mock('livekit-server-sdk', () => ({
  AccessToken: vi.fn().mockImplementation((...args: unknown[]) => {
    mockCtor(...args);
    return { addGrant: mockAddGrant, toJwt: () => Promise.resolve('jwt') };
  }),
}));
vi.mock('@/lib/ice-servers', () => ({
  getIceServers: () => Promise.resolve([{ urls: 'turn:turn.pairux.com:3478' }]),
}));

const KEY = 'pux_pk_qrypt_test_key_0123456789abcdef';
const req = (body: unknown, key: string | null = KEY) =>
  new Request('https://pairux.com/api/v1/partner/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv(
    'PAIRUX_PARTNERS',
    JSON.stringify([
      { id: 'qrypt', name: 'qrypt.chat', keySha256: hashPartnerKey(KEY), maxParticipants: 8 },
    ])
  );
  vi.stubEnv('LIVEKIT_API_KEY', 'k');
  vi.stubEnv('LIVEKIT_API_SECRET', 's');
  vi.stubEnv('NEXT_PUBLIC_LIVEKIT_URL', 'wss://sfu.pairux.com');
  mockAddGrant.mockClear();
  mockCtor.mockClear();
});

describe('partner keys', () => {
  it('store only a hash and match in constant time', () => {
    const partners = partnersFromEnv();
    expect(partners).toEqual([
      { id: 'qrypt', name: 'qrypt.chat', keySha256: hashPartnerKey(KEY), maxParticipants: 8 },
    ]);
    expect(JSON.stringify(partners)).not.toContain(KEY);
    expect(authenticatePartner(req({}), partners)?.id).toBe('qrypt');
    expect(
      authenticatePartner(req({}, 'pux_pk_wrong_key_0123456789abcdefgh'), partners)
    ).toBeNull();
    expect(authenticatePartner(req({}, null), partners)).toBeNull();
  });

  it('ignore malformed config', () => {
    expect(partnersFromEnv('not json')).toEqual([]);
    expect(partnersFromEnv(JSON.stringify([{ id: 'Bad Id', keySha256: 'x' }]))).toEqual([]);
  });
});

describe('POST /api/v1/partner/token', () => {
  it('mints a token for a room in the partner namespace', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ room: 'conv-123', identity: 'user-9', name: 'Alice' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: Record<string, unknown> } & Record<string, unknown>;
    const data = json.data ?? json;
    expect(data).toMatchObject({
      token: 'jwt',
      url: 'wss://sfu.pairux.com',
      roomName: 'partner-qrypt-conv-123',
      e2ee: true,
      maxParticipants: 8,
    });
    expect(mockCtor).toHaveBeenCalledWith(
      'k',
      's',
      expect.objectContaining({ identity: 'qrypt:user-9', name: 'Alice', ttl: '6h' })
    );
    expect(mockAddGrant).toHaveBeenCalledWith(
      expect.objectContaining({ room: 'partner-qrypt-conv-123', roomJoin: true, canPublish: true })
    );
  });

  it('refuses a missing or wrong key', async () => {
    const { POST } = await import('./route');
    expect((await POST(req({ room: 'r', identity: 'u', name: 'A' }, null))).status).toBe(401);
    expect(
      (
        await POST(
          req({ room: 'r', identity: 'u', name: 'A' }, 'pux_pk_wrong_key_0123456789abcdefgh')
        )
      ).status
    ).toBe(401);
    expect(mockCtor).not.toHaveBeenCalled();
  });

  it('refuses a room id that could escape the namespace', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ room: '../session-abc', identity: 'u', name: 'A' }));
    expect(res.status).toBe(400);
    expect(mockCtor).not.toHaveBeenCalled();
  });
});
