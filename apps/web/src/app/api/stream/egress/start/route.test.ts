import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockStartRoomCompositeEgress = vi.fn();
const mockListEgress = vi.fn();
const mockStopEgress = vi.fn();
const mockStreamOutputCtor = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@/lib/livekit-egress', () => ({
  getEgressClient: () => ({
    startRoomCompositeEgress: mockStartRoomCompositeEgress,
    listEgress: mockListEgress,
    stopEgress: mockStopEgress,
  }),
}));

vi.mock('livekit-server-sdk', () => ({
  StreamOutput: vi.fn().mockImplementation((opts: unknown) => {
    mockStreamOutputCtor(opts);
    return opts;
  }),
  StreamProtocol: { RTMP: 1 },
  EncodingOptions: vi.fn().mockImplementation((opts: unknown) => opts),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
    }),
  }),
}));

const sessionId = '00000000-0000-0000-0000-000000000001';
const hostSession = {
  id: sessionId,
  creator_id: mockUser.id,
  current_host_id: mockUser.id,
  host_user_id: mockUser.id,
};

function createRequest(body: unknown) {
  return new Request('http://localhost/api/stream/egress/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
  mockSingle.mockResolvedValue({ data: hostSession, error: null });
  mockStartRoomCompositeEgress.mockResolvedValue({ egressId: 'eg-combined' });
  mockListEgress.mockResolvedValue([]);
  mockStopEgress.mockResolvedValue({});
});

describe('POST /api/stream/egress/start', () => {
  it('rejects unauthenticated requests', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ user: null, error: null });
    const res = await POST(
      createRequest({ sessionId, rtmpUrls: ['rtmp://a.rtmp.youtube.com/live2/key'] })
    );
    expect(res.status).toBe(401);
  });

  it('rejects non-rtmp destination URLs', async () => {
    const res = await POST(createRequest({ sessionId, rtmpUrls: ['https://example.com/steal'] }));
    expect(res.status).toBe(400);
  });

  it('rejects callers who are not the session host', async () => {
    mockSingle.mockResolvedValue({
      data: { ...hostSession, creator_id: 'x', current_host_id: 'y', host_user_id: 'z' },
      error: null,
    });
    const res = await POST(
      createRequest({ sessionId, rtmpUrls: ['rtmp://a.rtmp.youtube.com/live2/key'] })
    );
    expect(res.status).toBe(403);
  });

  it('starts a single composite fanning out to all destinations', async () => {
    const urls = ['rtmp://a.rtmp.youtube.com/live2/yt-key', 'rtmp://live.twitch.tv/app/tw-key'];
    const res = await POST(createRequest({ sessionId, rtmpUrls: urls }));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { egressId: string; egressIds: string[] } };
    expect(json.data.egressIds).toEqual(['eg-combined']);
    expect(json.data.egressId).toBe('eg-combined');

    // One composite (one Chrome render + one H264 encode) carrying every URL in
    // a single StreamOutput — half the CPU of one-egress-per-destination.
    expect(mockStartRoomCompositeEgress).toHaveBeenCalledTimes(1);
    expect(mockStartRoomCompositeEgress).toHaveBeenCalledWith(
      `session-${sessionId}`,
      expect.objectContaining({ stream: expect.objectContaining({ urls }) }),
      expect.objectContaining({
        layout: 'speaker',
        // 1s keyframe interval so YouTube Live leaves "Preparing" reliably
        encodingOptions: expect.objectContaining({ keyFrameInterval: 1, height: 1080 }),
      })
    );
  });

  it('stops any egress already running for the room before starting a new one', async () => {
    mockListEgress.mockResolvedValue([{ egressId: 'old-1' }, { egressId: 'old-2' }]);

    const res = await POST(
      createRequest({ sessionId, rtmpUrls: ['rtmp://live.twitch.tv/app/tw-key'] })
    );

    expect(res.status).toBe(200);
    expect(mockListEgress).toHaveBeenCalledWith({ roomName: `session-${sessionId}`, active: true });
    expect(mockStopEgress).toHaveBeenCalledTimes(2);
    expect(mockStopEgress).toHaveBeenCalledWith('old-1');
    expect(mockStopEgress).toHaveBeenCalledWith('old-2');
    expect(mockStartRoomCompositeEgress).toHaveBeenCalledTimes(1);
  });

  it('still starts when there is no existing egress to stop', async () => {
    const res = await POST(
      createRequest({ sessionId, rtmpUrls: ['rtmp://live.twitch.tv/app/tw-key'] })
    );

    expect(res.status).toBe(200);
    expect(mockStopEgress).not.toHaveBeenCalled();
    expect(mockStartRoomCompositeEgress).toHaveBeenCalledTimes(1);
  });
});
