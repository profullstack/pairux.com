import { describe, it, expect } from 'vitest';
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
