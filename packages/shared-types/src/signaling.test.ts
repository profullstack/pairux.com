import { describe, it, expect } from 'vitest';
import type {
  SignalMessage,
  OfferMessage,
  AnswerMessage,
  IceCandidateMessage,
  ControlMessage,
  ConnectionState,
  NetworkQuality,
  PresenceState,
} from './signaling';

describe('Signaling Types', () => {
  describe('SignalMessage', () => {
    it('should create a valid offer message', () => {
      const offer: OfferMessage = {
        type: 'offer',
        senderId: 'user-123',
        timestamp: Date.now(),
        sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1...',
      };
      expect(offer.type).toBe('offer');
      expect(offer.sdp).toContain('v=0');
    });

    it('should create a valid answer message', () => {
      const answer: AnswerMessage = {
        type: 'answer',
        senderId: 'user-456',
        timestamp: Date.now(),
        sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1...',
      };
      expect(answer.type).toBe('answer');
    });

    it('should create a valid ICE candidate message', () => {
      const candidate: IceCandidateMessage = {
        type: 'ice-candidate',
        senderId: 'user-123',
        timestamp: Date.now(),
        candidate: {
          candidate: 'candidate:842163049 1 udp 1677729535 192.168.1.100 54321 typ srflx',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      };
      expect(candidate.type).toBe('ice-candidate');
      expect(candidate.candidate.sdpMid).toBe('0');
    });

    it('should handle signal message union type', () => {
      const messages: SignalMessage[] = [
        { type: 'offer', senderId: '1', timestamp: 1, sdp: 'offer-sdp' },
        { type: 'answer', senderId: '2', timestamp: 2, sdp: 'answer-sdp' },
        {
          type: 'ice-candidate',
          senderId: '3',
          timestamp: 3,
          candidate: { candidate: 'test' },
        },
      ];

      expect(messages).toHaveLength(3);
      expect(messages[0]?.type).toBe('offer');
      expect(messages[1]?.type).toBe('answer');
      expect(messages[2]?.type).toBe('ice-candidate');
    });
  });

  describe('ControlMessage', () => {
    it('should create control request message', () => {
      const request: ControlMessage = {
        type: 'control-request',
        participantId: 'viewer-123',
        timestamp: Date.now(),
      };
      expect(request.type).toBe('control-request');
    });

    it('should create control grant message', () => {
      const grant: ControlMessage = {
        type: 'control-grant',
        participantId: 'viewer-123',
        timestamp: Date.now(),
      };
      expect(grant.type).toBe('control-grant');
    });

    it('should create control revoke message', () => {
      const revoke: ControlMessage = {
        type: 'control-revoke',
        participantId: 'viewer-123',
        timestamp: Date.now(),
      };
      expect(revoke.type).toBe('control-revoke');
    });
  });

  describe('ConnectionState', () => {
    it('should accept valid connection states', () => {
      const states: ConnectionState[] = [
        'idle',
        'connecting',
        'connected',
        'reconnecting',
        'failed',
        'disconnected',
      ];
      expect(states).toHaveLength(6);
    });
  });

  describe('NetworkQuality', () => {
    it('should accept valid network quality levels', () => {
      const qualities: NetworkQuality[] = ['excellent', 'good', 'poor', 'bad'];
      expect(qualities).toHaveLength(4);
    });
  });

  describe('PresenceState', () => {
    it('should create valid presence state', () => {
      const presence: PresenceState = {
        id: 'user-123',
        displayName: 'Test User',
        role: 'host',
        online_at: new Date().toISOString(),
      };
      expect(presence.role).toBe('host');
      expect(presence.displayName).toBe('Test User');
    });
  });
});
