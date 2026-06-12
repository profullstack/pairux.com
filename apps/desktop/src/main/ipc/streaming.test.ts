import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../streaming', () => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  stopAllStreams: vi.fn(),
  startAllStreams: vi.fn(),
  writeStreamChunk: vi.fn(),
  getStreamStatus: vi.fn(),
  getAllStreamStatuses: vi.fn(),
}));

const mockGetDestinations = vi.fn();
const mockGetDecryptedStreamKeys = vi.fn();

vi.mock('../streaming/destinations', () => ({
  getDestinations: (...args: unknown[]) => mockGetDestinations(...args),
  addDestination: vi.fn(),
  updateDestination: vi.fn(),
  removeDestination: vi.fn(),
  getStreamKey: vi.fn(),
  getDecryptedStreamKeys: (...args: unknown[]) => mockGetDecryptedStreamKeys(...args),
  PLATFORM_PRESETS: {},
}));

describe('Streaming IPC handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockHandlers.clear();
    const { registerStreamingHandlers } = await import('./streaming');
    registerStreamingHandlers();
  });

  describe('rtmp:getServerStreamUrls', () => {
    it('composes rtmpUrl/streamKey for enabled destinations only', () => {
      mockGetDestinations.mockReturnValue([
        { id: 'yt', enabled: true, rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2' },
        { id: 'tw', enabled: true, rtmpUrl: 'rtmp://live.twitch.tv/app' },
        { id: 'fb', enabled: false, rtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
      ]);
      // Keyed by destination id; fb is filtered before key lookup, and a
      // destination with no stored key must be skipped, not sent keyless.
      mockGetDecryptedStreamKeys.mockReturnValue(
        new Map([
          ['yt', 'yt-key'],
          // tw intentionally missing
        ])
      );

      const handler = mockHandlers.get('rtmp:getServerStreamUrls');
      expect(handler).toBeDefined();
      const urls = handler?.() as string[];

      expect(urls).toEqual(['rtmp://a.rtmp.youtube.com/live2/yt-key']);
      // Disabled destinations never reach key decryption
      const passed = mockGetDecryptedStreamKeys.mock.calls[0][0] as { id: string }[];
      expect(passed.map((d) => d.id)).toEqual(['yt', 'tw']);
    });
  });
});
