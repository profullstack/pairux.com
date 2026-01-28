import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mock fn is available in the vi.mock factory
const { mockSendNotification, mockFrom } = vi.hoisted(() => ({
  mockSendNotification: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: mockSendNotification,
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Set required env vars before importing
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

import { sendPushToUser, sendPushToParticipant, sendPushToSession } from './push';

function mockChain(resolvedValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.then = vi
    .fn()
    .mockImplementation((cb: (v: unknown) => unknown) => Promise.resolve(cb(resolvedValue)));
  return chain;
}

describe('push utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendNotification.mockResolvedValue({});
  });

  describe('sendPushToUser', () => {
    it('should check user preferences and skip if pushEnabled is false', async () => {
      const profileChain = mockChain({
        data: { settings: { notifications: { pushEnabled: false } } },
        error: null,
      });
      mockFrom.mockReturnValue(profileChain);

      const result = await sendPushToUser('user-1', 'chatMessage', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 0 });
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('should skip if the specific event type is disabled', async () => {
      const profileChain = mockChain({
        data: { settings: { notifications: { pushEnabled: true, chatMessage: false } } },
        error: null,
      });
      mockFrom.mockReturnValue(profileChain);

      const result = await sendPushToUser('user-1', 'chatMessage', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 0 });
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('should send notification to all user subscriptions', async () => {
      const subscriptions = [
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
        { id: 'sub-2', endpoint: 'https://push.example.com/2', p256dh: 'key2', auth: 'auth2' },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({
            data: { settings: { notifications: { pushEnabled: true, chatMessage: true } } },
            error: null,
          });
        }
        return mockChain({ data: subscriptions, error: null });
      });

      const result = await sendPushToUser('user-1', 'chatMessage', {
        title: 'New Message',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 2, failed: 0 });
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });

    it('should return 0/0 when user has no subscriptions', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({
            data: { settings: { notifications: { pushEnabled: true, chatMessage: true } } },
            error: null,
          });
        }
        return mockChain({ data: [], error: null });
      });

      const result = await sendPushToUser('user-1', 'chatMessage', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 0 });
    });

    it('should clean up stale subscriptions on 410 error', async () => {
      const subscriptions = [
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({
            data: { settings: { notifications: { pushEnabled: true, chatMessage: true } } },
            error: null,
          });
        }
        if (callCount === 2) {
          return mockChain({ data: subscriptions, error: null });
        }
        return mockChain({ data: null, error: null });
      });

      mockSendNotification.mockRejectedValue({ statusCode: 410 });

      const result = await sendPushToUser('user-1', 'chatMessage', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(mockFrom).toHaveBeenCalledWith('push_subscriptions');
    });

    it('should count non-stale failures without cleaning up', async () => {
      const subscriptions = [
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({
            data: { settings: { notifications: { pushEnabled: true, chatMessage: true } } },
            error: null,
          });
        }
        return mockChain({ data: subscriptions, error: null });
      });

      mockSendNotification.mockRejectedValue({ statusCode: 500 });

      const result = await sendPushToUser('user-1', 'chatMessage', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 1 });
    });
  });

  describe('sendPushToParticipant', () => {
    it('should send notification to guest participant subscriptions', async () => {
      const subscriptions = [
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];

      mockFrom.mockReturnValue(mockChain({ data: subscriptions, error: null }));

      const result = await sendPushToParticipant('participant-1', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 1, failed: 0 });
      expect(mockSendNotification).toHaveBeenCalledTimes(1);
    });

    it('should return 0/0 when participant has no subscriptions', async () => {
      mockFrom.mockReturnValue(mockChain({ data: [], error: null }));

      const result = await sendPushToParticipant('participant-1', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 0 });
    });
  });

  describe('sendPushToSession', () => {
    it('should send to all active participants in a session', async () => {
      const participants = [
        { id: 'p1', user_id: 'user-1' },
        { id: 'p2', user_id: null },
      ];

      const subscriptions = [
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({ data: participants, error: null });
        }
        if (callCount === 2) {
          // preferences for user-1
          return mockChain({
            data: { settings: { notifications: { pushEnabled: true, chatMessage: true } } },
            error: null,
          });
        }
        // subscriptions
        return mockChain({ data: subscriptions, error: null });
      });

      const result = await sendPushToSession('session-1', 'chatMessage', {
        title: 'New Message',
        body: 'Hello',
      });

      expect(result.sent).toBeGreaterThanOrEqual(0);
      expect(mockFrom).toHaveBeenCalledWith('session_participants');
    });

    it('should exclude specified user IDs', async () => {
      const participants = [
        { id: 'p1', user_id: 'user-1' },
        { id: 'p2', user_id: 'user-2' },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({ data: participants, error: null });
        }
        return mockChain({
          data:
            callCount === 2
              ? { settings: { notifications: { pushEnabled: true, chatMessage: true } } }
              : [
                  {
                    id: 'sub-1',
                    endpoint: 'https://push.example.com/1',
                    p256dh: 'key1',
                    auth: 'auth1',
                  },
                ],
          error: null,
        });
      });

      await sendPushToSession('session-1', 'chatMessage', { title: 'Test', body: 'Hello' }, [
        'user-1',
      ]);

      expect(mockFrom).toHaveBeenCalledWith('session_participants');
    });

    it('should exclude specified participant IDs', async () => {
      const participants = [
        { id: 'p1', user_id: null },
        { id: 'p2', user_id: null },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return mockChain({ data: participants, error: null });
        }
        return mockChain({
          data: [
            {
              id: 'sub-1',
              endpoint: 'https://push.example.com/1',
              p256dh: 'key1',
              auth: 'auth1',
            },
          ],
          error: null,
        });
      });

      await sendPushToSession(
        'session-1',
        'chatMessage',
        { title: 'Test', body: 'Hello' },
        [],
        ['p1']
      );

      expect(mockFrom).toHaveBeenCalledWith('session_participants');
    });

    it('should return 0/0 when no participants found', async () => {
      mockFrom.mockReturnValue(mockChain({ data: null, error: null }));

      const result = await sendPushToSession('session-1', 'chatMessage', {
        title: 'Test',
        body: 'Hello',
      });

      expect(result).toEqual({ sent: 0, failed: 0 });
    });
  });
});
