import { describe, it, expect } from 'vitest';
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  joinSessionSchema,
  guestJoinSchema,
  createSessionSchema,
  updateScheduledMeetingSchema,
} from './validations';

describe('signupSchema', () => {
  it('validates a correct signup input', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password1',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({
      email: 'invalid-email',
      password: 'Password1',
      confirmPassword: 'Password1',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without uppercase', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'password1',
      confirmPassword: 'password1',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]!.message).toContain('uppercase');
    }
  });

  it('rejects password without number', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password',
      confirmPassword: 'Password',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]!.message).toContain('number');
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Pass1',
      confirmPassword: 'Pass1',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]!.message).toContain('8 characters');
    }
  });

  it('rejects mismatched passwords', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password2',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]!.message).toContain('Passwords do not match');
    }
  });

  it('rejects missing first name', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password1',
      firstName: '',
      lastName: 'User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing last name', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password1',
      firstName: 'Test',
      lastName: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('validates a correct login input', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'anypassword',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'password',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('validates a correct email', () => {
    const result = forgotPasswordSchema.safeParse({
      email: 'test@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = forgotPasswordSchema.safeParse({
      email: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('validates matching passwords', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'NewPassword1',
      confirmPassword: 'NewPassword1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'NewPassword1',
      confirmPassword: 'DifferentPassword1',
    });
    expect(result.success).toBe(false);
  });
});

describe('joinSessionSchema', () => {
  it('validates a correct join code and display name', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'ABC123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.joinCode).toBe('ABC123');
    }
  });

  it('transforms lowercase join code to uppercase', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'abc123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.joinCode).toBe('ABC123');
    }
  });

  it('rejects join code with wrong length', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'ABC',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects join code with invalid characters', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'ABC-12',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });
});

describe('guestJoinSchema', () => {
  it('validates a correct display name', () => {
    const result = guestJoinSchema.safeParse({
      displayName: 'Guest User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects display name too short', () => {
    const result = guestJoinSchema.safeParse({
      displayName: 'G',
    });
    expect(result.success).toBe(false);
  });
});

describe('createSessionSchema', () => {
  it('validates with defaults', () => {
    const result = createSessionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowGuestControl).toBe(false);
      expect(result.data.maxParticipants).toBe(5);
      expect(result.data.mode).toBe('p2p');
    }
  });

  it('validates with custom values', () => {
    const result = createSessionSchema.safeParse({
      name: 'My Session',
      allowGuestControl: true,
      maxParticipants: 3,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Session');
      expect(result.data.allowGuestControl).toBe(true);
      expect(result.data.maxParticipants).toBe(3);
    }
  });

  it('rejects maxParticipants outside range', () => {
    const result = createSessionSchema.safeParse({
      maxParticipants: 200,
    });
    expect(result.success).toBe(false);
  });

  it('accepts maxParticipants up to the Plus listener cap (100)', () => {
    const result = createSessionSchema.safeParse({
      maxParticipants: 100,
    });
    expect(result.success).toBe(true);
  });

  it('validates p2p mode', () => {
    const result = createSessionSchema.safeParse({
      mode: 'p2p',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('p2p');
    }
  });

  it('validates sfu mode', () => {
    const result = createSessionSchema.safeParse({
      mode: 'sfu',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('sfu');
    }
  });

  it('rejects invalid mode', () => {
    const result = createSessionSchema.safeParse({
      mode: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateScheduledMeetingSchema', () => {
  it('normalises camelCase input to column names', () => {
    const result = updateScheduledMeetingSchema.safeParse({
      scheduledAt: '2026-09-02T18:30:00.000Z',
      durationMinutes: 90,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        scheduled_at: '2026-09-02T18:30:00.000Z',
        duration_minutes: 90,
      });
    }
  });

  it('accepts the column names directly', () => {
    const result = updateScheduledMeetingSchema.safeParse({
      scheduled_at: '2026-09-02T18:30:00.000Z',
      duration_minutes: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheduled_at).toBe('2026-09-02T18:30:00.000Z');
      expect(result.data.duration_minutes).toBe(30);
    }
  });

  it('omits fields that were not supplied', () => {
    const result = updateScheduledMeetingSchema.safeParse({ title: 'Renamed' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: 'Renamed' });
      expect('inviteeEmails' in result.data).toBe(false);
    }
  });

  it('turns a cleared description into null', () => {
    const result = updateScheduledMeetingSchema.safeParse({ description: '   ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it('lowercases, trims and de-duplicates invitee emails', () => {
    const result = updateScheduledMeetingSchema.safeParse({
      inviteeEmails: ['A@example.com', 'a@example.com', 'b@example.com'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inviteeEmails).toEqual(['a@example.com', 'b@example.com']);
    }
  });

  it('keeps an empty invitee list distinct from an absent one', () => {
    const result = updateScheduledMeetingSchema.safeParse({ inviteeEmails: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inviteeEmails).toEqual([]);
    }
  });

  it('rejects an invalid email', () => {
    const result = updateScheduledMeetingSchema.safeParse({ inviteeEmails: ['nope'] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 50 invitees', () => {
    const emails = Array.from({ length: 51 }, (_, i) => `user${String(i)}@example.com`);
    const result = updateScheduledMeetingSchema.safeParse({ inviteeEmails: emails });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range duration', () => {
    expect(updateScheduledMeetingSchema.safeParse({ durationMinutes: 5 }).success).toBe(false);
    expect(updateScheduledMeetingSchema.safeParse({ durationMinutes: 600 }).success).toBe(false);
  });

  it('rejects a non-ISO date', () => {
    const result = updateScheduledMeetingSchema.safeParse({ scheduledAt: 'next tuesday' });
    expect(result.success).toBe(false);
  });
});
