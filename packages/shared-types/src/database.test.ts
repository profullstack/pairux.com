import { describe, it, expect } from 'vitest';
import {
  LISTENER_CAP,
  PARTICIPANT_CAP,
  PLAN_PRICE_USD,
  SEAT_PRESENCE_SECONDS,
  holdsSeat,
  nextPlan,
  planForCap,
  seatKindFor,
  seatUsage,
} from './database';
import type {
  SessionStatus,
  ParticipantRole,
  ControlState,
  SessionSettings,
  Session,
  SessionParticipant,
  Profile,
} from './database';

describe('Database Types', () => {
  describe('SessionStatus', () => {
    it('should accept valid session statuses', () => {
      const statuses: SessionStatus[] = ['created', 'active', 'paused', 'ended'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('ParticipantRole', () => {
    it('should accept valid participant roles', () => {
      const roles: ParticipantRole[] = ['host', 'viewer'];
      expect(roles).toHaveLength(2);
    });
  });

  describe('ControlState', () => {
    it('should accept valid control states', () => {
      const states: ControlState[] = ['view-only', 'requested', 'granted'];
      expect(states).toHaveLength(3);
    });
  });

  describe('SessionSettings', () => {
    it('should allow partial settings', () => {
      const settings: SessionSettings = {
        quality: 'high',
      };
      expect(settings.quality).toBe('high');
      expect(settings.allowControl).toBeUndefined();
    });

    it('should allow all settings', () => {
      const settings: SessionSettings = {
        quality: 'medium',
        allowControl: true,
        maxParticipants: 5,
      };
      expect(settings.quality).toBe('medium');
      expect(settings.allowControl).toBe(true);
      expect(settings.maxParticipants).toBe(5);
    });
  });

  describe('Session', () => {
    it('should define a valid session object', () => {
      const session: Session = {
        id: 'test-uuid',
        host_user_id: 'host-uuid',
        status: 'active',
        join_code: 'abc123',
        settings: { quality: 'high' },
        created_at: '2024-01-01T00:00:00Z',
        ended_at: null,
      };
      expect(session.id).toBe('test-uuid');
      expect(session.status).toBe('active');
      expect(session.ended_at).toBeNull();
    });
  });

  describe('SessionParticipant', () => {
    it('should define a valid participant object', () => {
      const participant: SessionParticipant = {
        id: 'participant-uuid',
        session_id: 'session-uuid',
        user_id: 'user-uuid',
        display_name: 'Test User',
        role: 'viewer',
        control_state: 'view-only',
        joined_at: '2024-01-01T00:00:00Z',
        left_at: null,
      };
      expect(participant.role).toBe('viewer');
      expect(participant.control_state).toBe('view-only');
    });

    it('should allow null user_id for anonymous participants', () => {
      const participant: SessionParticipant = {
        id: 'participant-uuid',
        session_id: 'session-uuid',
        user_id: null,
        display_name: 'Guest',
        role: 'viewer',
        control_state: 'view-only',
        joined_at: '2024-01-01T00:00:00Z',
        left_at: null,
      };
      expect(participant.user_id).toBeNull();
    });
  });

  describe('Profile', () => {
    it('should define a valid profile object', () => {
      const profile: Profile = {
        id: 'user-uuid',
        display_name: 'Test User',
        avatar_url: 'https://example.com/avatar.png',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      expect(profile.display_name).toBe('Test User');
    });

    it('should allow nullable fields', () => {
      const profile: Profile = {
        id: 'user-uuid',
        display_name: null,
        avatar_url: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      expect(profile.display_name).toBeNull();
      expect(profile.avatar_url).toBeNull();
    });
  });
});

describe('plan upgrade helpers', () => {
  it('maps each plan to the one that lifts its cap', () => {
    expect(nextPlan('free')).toBe('plus');
    expect(nextPlan('plus')).toBe('pro');
    expect(nextPlan('pro')).toBe('team');
    expect(nextPlan('team')).toBeNull();
  });

  it('reads the plan a room was sized for from its cap', () => {
    expect(planForCap(PARTICIPANT_CAP.free)).toBe('free');
    expect(planForCap(PARTICIPANT_CAP.plus)).toBe('plus');
    expect(planForCap(PARTICIPANT_CAP.pro)).toBe('pro');
    expect(planForCap(PARTICIPANT_CAP.team)).toBe('team');
  });

  it('caps Free at 2 participants and 20 listeners; paid plans keep their limits', () => {
    expect(PARTICIPANT_CAP).toEqual({ free: 2, plus: 100, pro: 500, team: 2000 });
    expect(LISTENER_CAP).toEqual({ free: 20, plus: 100, pro: 500, team: 2000 });
  });

  it('prices the paid plans as the pricing page does', () => {
    expect(PLAN_PRICE_USD).toEqual({ plus: 1, pro: 12, team: 49 });
  });
});

describe('seat counting', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const seen = (secondsAgo: number): string => new Date(now - secondsAgo * 1000).toISOString();
  const windowSeconds: number = SEAT_PRESENCE_SECONDS;
  const host = 'host-user';
  interface Row {
    user_id: string | null;
    left_at: string | null;
    last_seen_at: string | null;
    kind: 'human' | 'agent';
  }
  const row = (over: Partial<Row> = {}): Row => ({
    user_id: null,
    left_at: null,
    last_seen_at: seen(10),
    kind: 'human',
    ...over,
  });

  it('signed-in joiners are participants in any mode; anonymous guests only in P2P', () => {
    expect(seatKindFor(true, 'sfu')).toBe('participants');
    expect(seatKindFor(true, 'p2p')).toBe('participants');
    expect(seatKindFor(false, 'p2p')).toBe('participants');
    expect(seatKindFor(false, 'sfu')).toBe('listeners');
  });

  it('always counts the host as one participant, present or not', () => {
    expect(seatUsage([], { hostUserId: host, mode: 'p2p' }, now)).toEqual({
      participants: 1,
      listeners: 0,
    });
    expect(
      seatUsage([row({ user_id: host })], { hostUserId: host, mode: 'p2p' }, now).participants
    ).toBe(1);
  });

  it('counts an anonymous P2P guest as a participant, so Free is full at host + 1', () => {
    const usage = seatUsage([row()], { hostUserId: host, mode: 'p2p' }, now);
    expect(usage).toEqual({ participants: 2, listeners: 0 });
    expect(usage.participants >= PARTICIPANT_CAP.free).toBe(true);
  });

  it('counts anonymous SFU guests as listeners and signed-in SFU joiners as participants', () => {
    const usage = seatUsage(
      [row(), row(), row({ user_id: 'u2' })],
      { hostUserId: host, mode: 'sfu' },
      now
    );
    expect(usage).toEqual({ participants: 2, listeners: 2 });
  });

  it('frees the seat of a row that left, went quiet, or is an agent', () => {
    const rows = [
      row({ left_at: seen(5) }),
      row({ last_seen_at: seen(windowSeconds + 1) }),
      row({ last_seen_at: null }),
      row({ kind: 'agent' }),
    ];
    expect(seatUsage(rows, { hostUserId: host, mode: 'p2p' }, now).participants).toBe(1);
    expect(holdsSeat(row({ last_seen_at: seen(windowSeconds - 1) }), now)).toBe(true);
  });
});
